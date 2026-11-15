import type { ActorRole, Baseline, BaselinePolicy, Observation } from '../../contracts/types'
import { numericValue } from './observations'
import { MIN_BASELINE_READINGS, summarize } from './series'

/**
 * Versioned personal baselines (v3.1).
 *
 * A baseline is a DESCRIPTIVE summary of readings a person chose (or a policy selected). It is
 * not a reference range. Every baseline records the policy and dataset that produced it, its
 * version and the baseline it replaces, so recalculation never loses history.
 *
 * Minimum readings: MIN_BASELINE_READINGS (3) is only the arithmetic floor below which a
 * median/mean is meaningless. The DEFAULT policy asks for more, and the number is a project
 * setting marked provisional — AEGIS does not claim any count is clinically sufficient.
 */

export const DEFAULT_BASELINE_POLICY: BaselinePolicy = { method: 'median', minReadings: 7, dataset: { type: 'last_n', n: 14 } }
export const BASELINE_POLICY_BASIS = 'Project default (provisional): chosen for demonstration, not derived from clinical evidence. The CMO may change it per parameter.'

export function describePolicy(p: BaselinePolicy): string {
  const ds = p.dataset.type === 'last_n' ? `last ${p.dataset.n} valid readings` : p.dataset.type === 'window' ? `readings ${p.dataset.from.slice(0, 10)} → ${p.dataset.to.slice(0, 10)}` : `${p.dataset.observationIds.length} selected readings`
  return `${p.method} of ${ds}; at least ${p.minReadings} required`
}

/** Readings a policy would use, from one subject/parameter/origin series (already filtered). */
export function selectDataset(records: readonly Observation[], policy: BaselinePolicy): Observation[] {
  const valid = records.filter(o => o.quality === 'valid' && numericValue(o) !== null)
  const d = policy.dataset
  if (d.type === 'last_n') return valid.slice(-Math.max(1, d.n))
  if (d.type === 'window') return valid.filter(o => o.effectiveAt >= d.from && o.effectiveAt <= d.to)
  const chosen = new Set(d.observationIds)
  return valid.filter(o => chosen.has(o.id))
}

export function policyProblems(policy: BaselinePolicy): string[] {
  const out: string[] = []
  if (!Number.isInteger(policy.minReadings) || policy.minReadings < MIN_BASELINE_READINGS) out.push(`Minimum readings must be a whole number of at least ${MIN_BASELINE_READINGS}.`)
  if (policy.dataset.type === 'last_n' && (!Number.isInteger(policy.dataset.n) || policy.dataset.n < policy.minReadings)) out.push('The dataset size must be at least the minimum number of readings.')
  if (policy.dataset.type === 'window' && policy.dataset.from > policy.dataset.to) out.push('Window start must be before its end.')
  return out
}

export function baselineVersions(baselines: readonly Baseline[], subjectId: string, parameterId: string): Baseline[] {
  return baselines.filter(b => b.subjectId === subjectId && b.parameterId === parameterId).sort((a, b) => (a.version ?? 1) - (b.version ?? 1) || a.establishedAt.localeCompare(b.establishedAt))
}

/**
 * Computes a new baseline version. `previous` (the current accepted/proposed one, if any) becomes
 * `supersedesId`; it is only marked superseded when the new version is accepted.
 */
export function computeBaseline(series: readonly Observation[], policy: BaselinePolicy, meta: { id: string; at: string; byRole: Extract<ActorRole, 'astronaut' | 'medical'>; existing: readonly Baseline[]; note?: string }): Baseline {
  const problems = policyProblems(policy)
  if (problems.length) throw new Error(problems.join(' '))
  const used = selectDataset(series, policy)
  if (used.length < policy.minReadings) throw new Error(`This policy needs at least ${policy.minReadings} valid readings; ${used.length} available.`)
  const subjects = new Set(used.map(o => o.subjectId)), params = new Set(used.map(o => o.parameterId)), origins = new Set(used.map(o => o.origin))
  if (subjects.size !== 1 || params.size !== 1 || origins.size !== 1) throw new Error('A baseline uses one subject, one parameter and one data origin.')
  const units = new Set(used.map(o => o.value?.type === 'quantity' ? o.value.unitId : 'scale'))
  if (units.size !== 1) throw new Error('Baseline readings must share one unit.')
  const s = summarize(used)!
  const subjectId = used[0]!.subjectId, parameterId = used[0]!.parameterId
  const history = baselineVersions(meta.existing, subjectId, parameterId)
  const current = history.filter(b => b.status !== 'superseded').at(-1)
  const version = (history.at(-1)?.version ?? history.length) + 1
  return {
    id: meta.id, subjectId, parameterId, unitId: [...units][0]!,
    method: policy.method === 'median' ? 'descriptive_median' : 'descriptive_mean', value: policy.method === 'median' ? s.median : s.mean,
    summary: { n: s.n, min: s.min, max: s.max }, observationIds: used.map(o => o.id), window: { from: s.first, to: s.last },
    establishedAt: meta.at, establishedByRole: meta.byRole, status: 'proposed', version, policy,
    ...(current ? { supersedesId: current.id } : {}), ...(meta.note ? { note: meta.note } : {}),
  }
}

/** Whether newer valid readings exist than the baseline's window — a prompt to consider recalculation, not a requirement. */
export function newerReadings(b: Baseline, series: readonly Observation[]): number {
  return series.filter(o => o.quality === 'valid' && numericValue(o) !== null && o.effectiveAt > b.window.to).length
}
