import type { AnalysisRule, AttentionItem, AttentionState, DataOrigin, HealthWorkspace, Observation } from '../../contracts/types'
import { adherence, occurrenceStatus } from './prevention'
import { numericValue } from './observations'
import type { Registry } from './registry'
import { activeBaseline, differenceFromBaseline, series } from './series'
import { trend } from './analytics'

/**
 * Configurable analysis rules → items needing attention (v3.1).
 *
 * A rule is data, not code: condition + status + basis. Output is an AttentionItem that says what
 * the data show and what the limitations are. It never names a condition or a treatment.
 *
 * Status:
 *  - 'demonstration': project-authored settings, shown with a DEMONSTRATION label in the UI.
 *  - 'approved': reserved for rules a medical authority approves. None ship with AEGIS, and
 *    `ruleProblems` rejects an 'approved' rule that carries a fixed demonstration cutoff.
 *  - 'disabled': kept for audit, not evaluated.
 */

const HOUR = 3_600_000

export function ruleProblems(rule: AnalysisRule, all: readonly AnalysisRule[], registry: Registry): string[] {
  const out: string[] = []
  const c = rule.condition
  const param = 'parameterId' in c ? registry.parameter(c.parameterId) : undefined
  if ('parameterId' in c && !param) out.push(`Unknown parameter '${c.parameterId}'.`)
  if (!rule.basis.trim()) out.push('A rule must state the basis for its settings.')
  if (c.type === 'demo_cutoff' && rule.status === 'approved') out.push('Fixed cutoffs are demonstration settings and cannot be marked approved.')
  if (c.type === 'baseline_deviation' && (!(c.percent > 0) || c.consecutive < 1)) out.push('Deviation needs a positive percentage and at least one reading.')
  if (c.type === 'trend' && (c.minReadings < 3 || !(c.windowDays > 0))) out.push('Trend rules need a window and at least 3 readings.')
  if (c.type === 'plan_adherence' && !(c.minFraction > 0 && c.minFraction <= 1)) out.push('Adherence fraction must be in (0, 1].')
  if (c.type === 'combination') for (const id of c.ruleIds) { if (id === rule.id || !all.some(r => r.id === id)) out.push(`Combination refers to unknown rule '${id}'.`) }
  return out
}

interface Hit { evidence: Observation[]; explanation: string; limitations: string[] }

function evaluateOne(rule: AnalysisRule, all: readonly AnalysisRule[], ws: HealthWorkspace, subjectId: string, origin: DataOrigin, now: string, registry: Registry, depth = 0): Hit | null {
  const c = rule.condition
  const s = (pid: string) => series(ws.observations, { subjectId, parameterId: pid, origin }).filter(o => o.effectiveAt <= now)
  const name = (pid: string) => registry.parameter(pid)?.displayName ?? pid
  switch (c.type) {
    case 'stale_data': {
      const recs = s(c.parameterId), last = recs.at(-1)
      const plans = ws.plans.filter(p => p.subjectId === subjectId && p.status === 'active' && p.parameterIds.includes(c.parameterId))
      if (!plans.length) return null // only meaningful when someone expects the data
      const age = last ? (Date.parse(now) - Date.parse(last.effectiveAt)) / HOUR : Infinity
      if (age <= c.maxAgeHours) return null
      return { evidence: last ? [last] : [], explanation: last ? `No ${name(c.parameterId)} reading for ${age.toFixed(0)} h although an active plan expects it (setting: ${c.maxAgeHours} h).` : `No ${name(c.parameterId)} reading recorded although an active plan expects it.`, limitations: ['Describes missing data, not health. The reading may have been taken but not logged.'] }
    }
    case 'baseline_deviation': {
      const b = activeBaseline(ws.baselines, subjectId, c.parameterId)
      if (!b || b.status !== 'accepted') return null
      const recent = s(c.parameterId).filter(o => o.effectiveAt > b.window.to).slice(-c.consecutive)
      if (recent.length < c.consecutive) return null
      const ok = recent.every(o => { const d = differenceFromBaseline(o, b); if (!d || d.relativePercent === null) return false; return c.direction === 'above' ? d.relativePercent >= c.percent : c.direction === 'below' ? d.relativePercent <= -c.percent : Math.abs(d.relativePercent) >= c.percent })
      if (!ok) return null
      return { evidence: recent, explanation: `The last ${c.consecutive} ${name(c.parameterId)} readings differ from the accepted personal baseline (${b.value.toFixed(1)}, v${b.version ?? 1}) by at least ${c.percent}% ${c.direction === 'either' ? '' : c.direction}.`, limitations: ['A difference from a personal baseline is not a clinical finding.', `Baseline formed from ${b.summary.n} readings.`] }
    }
    case 'trend': {
      const from = new Date(Date.parse(now) - c.windowDays * 24 * HOUR).toISOString()
      const recs = s(c.parameterId).filter(o => o.effectiveAt >= from)
      if (recs.length < c.minReadings) return null
      const t = trend(recs)
      if (!t || t.direction !== c.direction || Math.abs(t.slopePerDay) < c.minChangePerDay) return null
      return { evidence: recs, explanation: `${name(c.parameterId)} is ${c.direction} by about ${Math.abs(t.slopePerDay).toFixed(2)} per day over ${c.windowDays} days (n=${t.n}; interval excludes zero).`, limitations: ['Linear description of the window; it does not forecast.'] }
    }
    case 'plan_adherence': {
      const from = new Date(Date.parse(now) - c.windowDays * 24 * HOUR).toISOString()
      const plans = ws.plans.filter(p => p.subjectId === subjectId && p.status === 'active')
      const occ = plans.flatMap(p => occurrenceStatus(p, ws.completions, ws.observations.filter(o => o.origin === origin), from, now))
      const a = adherence(occ)
      if (a.fraction === null || a.due < 3 || a.fraction >= c.minFraction) return null
      return { evidence: [], explanation: `${a.done} of ${a.due} scheduled preventive activities in the last ${c.windowDays} days were logged (${Math.round(a.fraction * 100)}%; setting ${Math.round(c.minFraction * 100)}%).`, limitations: ['Counts logged activity only; unlogged activity may have occurred.'] }
    }
    case 'demo_cutoff': {
      const recent = s(c.parameterId).slice(-c.consecutive)
      if (recent.length < c.consecutive) return null
      const ok = recent.every(o => { const v = numericValue(o); return v !== null && (c.op === 'below' ? v < c.value : v >= c.value) })
      if (!ok) return null
      return { evidence: recent, explanation: `The last ${c.consecutive} ${name(c.parameterId)} readings are ${c.op === 'below' ? 'below' : 'at or above'} the demonstration cutoff ${c.value}.`, limitations: ['The cutoff is a demonstration setting, not a clinical limit.'] }
    }
    case 'combination': {
      if (depth > 3) return null
      const hits = c.ruleIds.map(id => { const r = all.find(x => x.id === id); return r ? evaluateOne(r, all, ws, subjectId, origin, now, registry, depth + 1) : null })
      if (hits.some(h => !h)) return null
      const hs = hits as Hit[]
      return { evidence: hs.flatMap(h => h.evidence), explanation: hs.map(h => h.explanation).join(' ') + ' These co-occur; co-occurrence does not establish a cause.', limitations: [...new Set(hs.flatMap(h => h.limitations))] }
    }
    case 'reference_value':
      return null // AEGIS ships no approved reference values; such rules stay inactive.
  }
}

/** Evaluates enabled rules for each subject. IDs are deterministic so states persist across re-evaluation. */
export function evaluateRules(rules: readonly AnalysisRule[], ws: HealthWorkspace, subjects: readonly string[], origin: DataOrigin, now: string, registry: Registry): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const rule of rules) {
    if (rule.status === 'disabled' || ruleProblems(rule, rules, registry).length) continue
    for (const subjectId of subjects) {
      const hit = evaluateOne(rule, rules, ws, subjectId, origin, now, registry)
      if (!hit) continue
      const key = hit.evidence.map(o => o.id).join('+') || now.slice(0, 10)
      items.push({
        id: `${rule.id}:${subjectId}:${origin}:${key}`, ruleId: rule.id, ruleStatus: rule.status, subjectId, origin,
        detectedAt: hit.evidence.at(-1)?.effectiveAt ?? now, title: rule.title, explanation: hit.explanation,
        evidenceObservationIds: [...new Set(hit.evidence.map(o => o.id))],
        limitations: [...hit.limitations, ...(rule.status === 'demonstration' ? ['DEMONSTRATION rule: settings chosen by the project team.'] : [])],
      })
    }
  }
  return items
}

/** Latest recorded state of an item (acknowledged/linked/dismissed), if any. */
export function attentionStatus(itemId: string, states: readonly AttentionState[]): AttentionState | undefined {
  return states.filter(s => s.itemId === itemId).at(-1)
}

const demoBasis = 'Demonstration setting chosen by the AEGIS project team for the prototype. Not derived from clinical evidence; not for clinical use.'
const rule = (r: Omit<AnalysisRule, 'status' | 'basis' | 'configuredByRole' | 'version' | 'sourceRefIds'> & { sourceRefIds?: string[] }): AnalysisRule =>
  ({ status: 'demonstration', basis: demoBasis, configuredByRole: 'system', version: 1, sourceRefIds: [], ...r })

/** Seeded rules. All are 'demonstration'. They express data-state and deviation-from-self, never normality. */
export const DEMO_RULES: AnalysisRule[] = [
  rule({ id: 'DQ-STALE-RHR', title: 'Expected readings are missing', description: 'Resting HR is in an active plan but no reading has arrived recently.', condition: { type: 'stale_data', parameterId: 'resting_hr', maxAgeHours: 36 } }),
  rule({ id: 'DQ-STALE-SLEEP', title: 'Expected sleep logs are missing', description: 'Sleep duration is in an active plan but no log has arrived recently.', condition: { type: 'stale_data', parameterId: 'sleep_duration', maxAgeHours: 36 } }),
  rule({ id: 'PREV-ADHERENCE', title: 'Preventive plan activity is low', description: 'Share of scheduled preventive activities logged over a week.', condition: { type: 'plan_adherence', minFraction: 0.7, windowDays: 7 } }),
  rule({ id: 'DEV-RHR-UP', title: 'Resting HR above personal baseline', description: 'Several consecutive readings above the accepted personal baseline.', condition: { type: 'baseline_deviation', parameterId: 'resting_hr', percent: 10, direction: 'above', consecutive: 3 } }),
  rule({ id: 'DEV-SLEEP-DOWN', title: 'Sleep below personal baseline', description: 'Several consecutive sleep logs below the accepted personal baseline.', condition: { type: 'baseline_deviation', parameterId: 'sleep_duration', percent: 15, direction: 'below', consecutive: 3 } }),
  rule({ id: 'TREND-MASS-DOWN', title: 'Body mass decreasing', description: 'Sustained decrease of body mass over two weeks.', condition: { type: 'trend', parameterId: 'body_mass', windowDays: 14, direction: 'decreasing', minChangePerDay: 0.05, minReadings: 5 } }),
  rule({ id: 'DEMO-SLEEP-LOW', title: 'Short sleep (demo cutoff)', description: 'Core v2 DEMO-RECOVERY-01 component: three sleep logs below 6 h.', condition: { type: 'demo_cutoff', parameterId: 'sleep_duration', op: 'below', value: 6, consecutive: 3 }, sourceRefIds: ['hrp-risks'] }),
  rule({ id: 'DEMO-FATIGUE-HIGH', title: 'High fatigue self-rating (demo cutoff)', description: 'Core v2 DEMO-RECOVERY-01 component: latest fatigue at least 7/10.', condition: { type: 'demo_cutoff', parameterId: 'fatigue', op: 'at_or_above', value: 7, consecutive: 1 } }),
  rule({ id: 'DEMO-RECOVERY-01', title: 'Recovery indicators changed', description: 'Core v2 rule re-expressed as a combination: short sleep together with high fatigue.', condition: { type: 'combination', ruleIds: ['DEMO-SLEEP-LOW', 'DEMO-FATIGUE-HIGH'] }, sourceRefIds: ['hrp-risks'] }),
]
