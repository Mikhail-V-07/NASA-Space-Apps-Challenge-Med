import type { Observation, ParameterDefinition } from '../../contracts/types'
import { numericValue } from './observations'
import { summarize } from './series'
import type { Summary } from './series'

/**
 * Analytics and assessment (v3.1) — DESCRIPTIVE ONLY.
 *
 * Every function here describes data: how much there is, how fresh, how complete, which way it
 * moves and how certain that description is. None of them says whether a value is healthy.
 * New analyses plug into ANALYSES without changing callers (extensible framework).
 */

const HOUR = 3_600_000, DAY = 24 * HOUR

export type WindowPreset = '24h' | '72h' | '7d' | '14d' | '30d' | 'all'
export interface WindowSpec { preset: WindowPreset | 'custom'; from?: string; to?: string }
export const WINDOW_PRESETS: { id: WindowPreset; label: string; hours: number | null }[] = [
  { id: '24h', label: '24 h', hours: 24 }, { id: '72h', label: '3 days', hours: 72 }, { id: '7d', label: '7 days', hours: 168 },
  { id: '14d', label: '14 days', hours: 336 }, { id: '30d', label: '30 days', hours: 720 }, { id: 'all', label: 'All data', hours: null },
]

/** Resolves a window to concrete bounds. 'all' starts at the earliest record (or `now`). */
export function resolveWindow(spec: WindowSpec, now: string, earliest?: string): { from: string; to: string } {
  if (spec.preset === 'custom') {
    if (!spec.from || !spec.to || spec.from > spec.to) throw new Error('A custom window needs a start before its end.')
    return { from: spec.from, to: spec.to }
  }
  const p = WINDOW_PRESETS.find(w => w.id === spec.preset)!
  const from = p.hours === null ? (earliest ?? now) : new Date(Date.parse(now) - p.hours * HOUR).toISOString()
  return { from, to: now }
}

export function inWindow(records: readonly Observation[], w: { from: string; to: string }): Observation[] {
  return records.filter(o => o.effectiveAt >= w.from && o.effectiveAt <= w.to)
}

export interface QualityBreakdown { total: number; valid: number; estimated: number; missing: number; invalid: number; usable: number }
export function qualityBreakdown(records: readonly Observation[]): QualityBreakdown {
  const q = { total: records.length, valid: 0, estimated: 0, missing: 0, invalid: 0, usable: 0 }
  for (const o of records) { q[o.quality]++; if (numericValue(o) !== null) q.usable++ }
  return q
}

/**
 * Completeness against an EXPECTED cadence (e.g. a plan's schedule): the share of expected slots
 * in the window holding at least one usable reading. Without a cadence it is not computable.
 */
export function completeness(records: readonly Observation[], w: { from: string; to: string }, expectedEveryHours: number | null): { expected: number; covered: number; fraction: number } | null {
  if (!expectedEveryHours || expectedEveryHours <= 0) return null
  const start = Date.parse(w.from), span = Date.parse(w.to) - start, slot = expectedEveryHours * HOUR
  const expected = Math.max(1, Math.floor(span / slot))
  const covered = new Set<number>()
  for (const o of records) {
    if (numericValue(o) === null) continue
    const k = Math.floor((Date.parse(o.effectiveAt) - start) / slot)
    if (k >= 0 && k < expected) covered.add(k)
  }
  return { expected, covered: covered.size, fraction: covered.size / expected }
}

export interface Trend {
  n: number
  /** Least-squares slope in canonical units per day. */
  slopePerDay: number
  /** Standard error of the slope; null below 3 points. */
  slopeStdError: number | null
  /** Approximate 95% interval (±1.96·SE). Indicates uncertainty of the DESCRIPTION, not risk. */
  interval: [number, number] | null
  changeOverWindow: number
  spanDays: number
  direction: 'increasing' | 'decreasing' | 'flat' | 'uncertain'
}

/** Linear trend of usable readings. 'uncertain' when the interval spans zero or data are too few. */
export function trend(records: readonly Observation[]): Trend | null {
  const pts = records.map(o => ({ t: Date.parse(o.effectiveAt) / DAY, v: numericValue(o) })).filter((p): p is { t: number; v: number } => p.v !== null)
  if (pts.length < 2) return null
  const n = pts.length, mt = pts.reduce((a, p) => a + p.t, 0) / n, mv = pts.reduce((a, p) => a + p.v, 0) / n
  const sxx = pts.reduce((a, p) => a + (p.t - mt) ** 2, 0)
  if (sxx === 0) return null
  const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) / sxx
  let se: number | null = null
  if (n >= 3) {
    const rss = pts.reduce((a, p) => a + (p.v - (mv + slope * (p.t - mt))) ** 2, 0)
    se = Math.sqrt(rss / (n - 2) / sxx)
  }
  const interval: [number, number] | null = se === null ? null : [slope - 1.96 * se, slope + 1.96 * se]
  const spanDays = pts.at(-1)!.t - pts[0]!.t
  const direction = interval === null ? 'uncertain' : interval[0] > 0 ? 'increasing' : interval[1] < 0 ? 'decreasing' : slope === 0 ? 'flat' : 'uncertain'
  return { n, slopePerDay: slope, slopeStdError: se, interval, changeOverWindow: slope * spanDays, spanDays, direction }
}

/** Spread of readings: interquartile range (descriptive). */
export function spread(records: readonly Observation[]): { q1: number; q3: number; iqr: number } | null {
  const v = records.map(numericValue).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (v.length < 4) return null
  const q = (p: number) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo]! + (v[hi]! - v[lo]!) * (i - lo) }
  return { q1: q(0.25), q3: q(0.75), iqr: q(0.75) - q(0.25) }
}

export interface WindowComparison { current: Summary | null; previous: Summary | null; medianChange: number | null }
/** Compares a window with the equally long window before it. */
export function compareWindows(records: readonly Observation[], w: { from: string; to: string }): WindowComparison {
  const len = Date.parse(w.to) - Date.parse(w.from)
  const prev = { from: new Date(Date.parse(w.from) - len).toISOString(), to: w.from }
  const current = summarize(inWindow(records, w)), previous = summarize(records.filter(o => o.effectiveAt >= prev.from && o.effectiveAt < prev.to))
  return { current, previous, medianChange: current && previous ? current.median - previous.median : null }
}

/** Aligns several series on shared day buckets for side-by-side reading (multi-parameter view). */
export function alignDaily(seriesById: Record<string, readonly Observation[]>): { day: string; values: Record<string, number | null> }[] {
  const days = new Map<string, Record<string, number[]>>()
  for (const [pid, recs] of Object.entries(seriesById)) for (const o of recs) {
    const v = numericValue(o); if (v === null) continue
    const d = o.effectiveAt.slice(0, 10), row = days.get(d) ?? {}
    ;(row[pid] ??= []).push(v); days.set(d, row)
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => ({
    day, values: Object.fromEntries(Object.keys(seriesById).map(pid => { const xs = row[pid]; return [pid, xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null] })),
  }))
}

// ── Extensible analysis framework ──

export interface AnalysisContext { window: { from: string; to: string }; now: string; expectedEveryHours: number | null }
export interface AnalysisResult { id: string; label: string; value: string; detail: string; limitation?: string }
export interface AnalysisDescriptor {
  id: string
  label: string
  applies(p: ParameterDefinition): boolean
  run(records: readonly Observation[], p: ParameterDefinition, ctx: AnalysisContext): AnalysisResult | null
}

const fmt = (x: number) => Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)
const unitOf = (p: ParameterDefinition) => p.canonicalUnitId ? ` ${p.canonicalUnitId}` : ''
const numeric = (p: ParameterDefinition) => p.valueType !== 'waveform' && p.status === 'active'

export const ANALYSES: AnalysisDescriptor[] = [
  {
    id: 'summary', label: 'Summary', applies: numeric,
    run: (r, p, c) => { const s = summarize(inWindow(r, c.window)); return s && { id: 'summary', label: 'Summary', value: `median ${fmt(s.median)}${unitOf(p)}`, detail: `n=${s.n}, range ${fmt(s.min)}–${fmt(s.max)}` } },
  },
  {
    id: 'trend', label: 'Trend', applies: numeric,
    run: (r, p, c) => {
      const t = trend(inWindow(r, c.window)); if (!t) return null
      return { id: 'trend', label: 'Trend', value: `${t.direction}`, detail: `${t.slopePerDay >= 0 ? '+' : ''}${fmt(t.slopePerDay)}${unitOf(p)}/day over ${t.spanDays.toFixed(1)} days, n=${t.n}${t.interval ? `; 95% interval ${fmt(t.interval[0])} to ${fmt(t.interval[1])}` : ''}`, limitation: t.n < 7 ? 'Few readings: the direction is weakly supported.' : 'Linear fit; describes the window only and does not forecast.' }
    },
  },
  {
    id: 'spread', label: 'Spread', applies: numeric,
    run: (r, p, c) => { const s = spread(inWindow(r, c.window)); return s && { id: 'spread', label: 'Spread (IQR)', value: `${fmt(s.iqr)}${unitOf(p)}`, detail: `Q1 ${fmt(s.q1)}, Q3 ${fmt(s.q3)}` } },
  },
  {
    id: 'window_change', label: 'Versus previous window', applies: numeric,
    run: (r, p, c) => { const w = compareWindows(r, c.window); return w.medianChange === null ? null : { id: 'window_change', label: 'Versus previous window', value: `${w.medianChange >= 0 ? '+' : ''}${fmt(w.medianChange)}${unitOf(p)}`, detail: `median ${fmt(w.previous!.median)} → ${fmt(w.current!.median)} (n ${w.previous!.n} → ${w.current!.n})` } },
  },
  {
    id: 'data_quality', label: 'Data quality', applies: () => true,
    run: (r, _p, c) => { const q = qualityBreakdown(inWindow(r, c.window)); return q.total ? { id: 'data_quality', label: 'Data quality', value: `${q.usable}/${q.total} usable`, detail: `valid ${q.valid}, estimated ${q.estimated}, missing ${q.missing}, invalid ${q.invalid}` } : null },
  },
  {
    id: 'completeness', label: 'Completeness', applies: () => true,
    run: (r, _p, c) => { const k = completeness(inWindow(r, c.window), c.window, c.expectedEveryHours); return k && { id: 'completeness', label: 'Completeness', value: `${Math.round(k.fraction * 100)}%`, detail: `${k.covered} of ${k.expected} expected slots (every ${c.expectedEveryHours} h, from the active plan)` } },
  },
  {
    id: 'freshness', label: 'Freshness', applies: () => true,
    run: (r, _p, c) => { const last = [...r].reverse().find(o => numericValue(o) !== null || o.value?.type === 'waveform'); if (!last) return null; const h = (Date.parse(c.now) - Date.parse(last.effectiveAt)) / HOUR; return { id: 'freshness', label: 'Freshness', value: h < 1 ? '<1 h old' : h < 48 ? `${h.toFixed(0)} h old` : `${(h / 24).toFixed(1)} days old`, detail: `Last usable reading ${last.effectiveAt.slice(0, 16).replace('T', ' ')}` } },
  },
]

export function runAnalyses(records: readonly Observation[], p: ParameterDefinition, ctx: AnalysisContext, analyses: readonly AnalysisDescriptor[] = ANALYSES): AnalysisResult[] {
  return analyses.filter(a => a.applies(p)).map(a => a.run(records, p, ctx)).filter((x): x is AnalysisResult => x !== null)
}
