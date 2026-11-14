import type { ActorRole, Baseline, DataOrigin, Observation } from '../../contracts/types'
import { numericValue } from './observations'

/**
 * Longitudinal analysis — DESCRIPTIVE ONLY.
 * Produces series, summaries, personal baselines and differences. It never labels a value as
 * normal/abnormal: that requires an approved reference value or rule (none ship with AEGIS).
 */

export interface SeriesQuery { subjectId: string; parameterId: string; origin: DataOrigin; from?: string; to?: string; includeUnusable?: boolean }

export function series(observations: readonly Observation[], q: SeriesQuery): Observation[] {
  return observations
    .filter(o => o.subjectId === q.subjectId && o.parameterId === q.parameterId && o.origin === q.origin)
    .filter(o => (!q.from || o.effectiveAt >= q.from) && (!q.to || o.effectiveAt <= q.to))
    .filter(o => q.includeUnusable || numericValue(o) !== null || o.value?.type === 'waveform')
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.recordedAt.localeCompare(b.recordedAt))
}

export interface Summary { n: number; min: number; max: number; median: number; mean: number; first: string; last: string }

export function summarize(records: readonly Observation[]): Summary | null {
  const usable = records.map(o => ({ o, v: numericValue(o) })).filter((x): x is { o: Observation; v: number } => x.v !== null)
  if (!usable.length) return null
  const values = usable.map(x => x.v).sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
  return { n: values.length, min: values[0]!, max: values.at(-1)!, median, mean: values.reduce((a, b) => a + b, 0) / values.length, first: usable[0]!.o.effectiveAt, last: usable.at(-1)!.o.effectiveAt }
}

/** Minimum readings before AEGIS proposes a descriptive baseline. A project convention, not a clinical rule. */
export const MIN_BASELINE_READINGS = 3

/**
 * Proposes a descriptive baseline (median of selected readings). Only valid readings in a
 * single unit contribute; estimated/synthetic data never mixes with observed data.
 */
export function proposeBaseline(records: readonly Observation[], meta: { id: string; at: string; byRole: Extract<ActorRole, 'astronaut' | 'medical'>; note?: string }): Baseline {
  const valid = records.filter(o => o.quality === 'valid' && numericValue(o) !== null)
  if (valid.length < MIN_BASELINE_READINGS) throw new Error(`At least ${MIN_BASELINE_READINGS} valid readings are needed; ${valid.length} available.`)
  const subjects = new Set(valid.map(o => o.subjectId)), params = new Set(valid.map(o => o.parameterId)), origins = new Set(valid.map(o => o.origin))
  if (subjects.size !== 1 || params.size !== 1 || origins.size !== 1) throw new Error('A baseline uses one subject, one parameter and one data origin.')
  const units = new Set(valid.map(o => o.value?.type === 'quantity' ? o.value.unitId : 'scale'))
  if (units.size !== 1) throw new Error('Baseline readings must share one unit.')
  const s = summarize(valid)!
  return {
    id: meta.id, subjectId: valid[0]!.subjectId, parameterId: valid[0]!.parameterId, unitId: [...units][0]!,
    method: 'descriptive_median', value: s.median, summary: { n: s.n, min: s.min, max: s.max },
    observationIds: valid.map(o => o.id), window: { from: s.first, to: s.last },
    establishedAt: meta.at, establishedByRole: meta.byRole, status: 'proposed', ...(meta.note ? { note: meta.note } : {}),
  }
}

/** The baseline currently in force for a subject/parameter: accepted takes precedence over proposed. */
export function activeBaseline(baselines: readonly Baseline[], subjectId: string, parameterId: string): Baseline | undefined {
  const own = baselines.filter(b => b.subjectId === subjectId && b.parameterId === parameterId && b.status !== 'superseded')
  return own.filter(b => b.status === 'accepted').at(-1) ?? own.at(-1)
}

export interface Difference { absolute: number; relativePercent: number | null; withinBaselineSpread: boolean }

/** Arithmetic difference from a baseline. `withinBaselineSpread` compares to the readings that formed it — descriptive, not clinical. */
export function differenceFromBaseline(o: Observation, b: Baseline): Difference | null {
  const v = numericValue(o)
  if (v === null || o.parameterId !== b.parameterId || o.subjectId !== b.subjectId) return null
  if (o.value?.type === 'quantity' && o.value.unitId !== b.unitId) return null
  return { absolute: v - b.value, relativePercent: b.value === 0 ? null : (v - b.value) / Math.abs(b.value) * 100, withinBaselineSpread: v >= b.summary.min && v <= b.summary.max }
}

/** Time since the most recent usable reading — a data-state indicator, not a health status. */
export function freshness(records: readonly Observation[], now: string): { lastAt: string; ageHours: number } | null {
  const last = [...records].reverse().find(o => numericValue(o) !== null || o.value?.type === 'waveform')
  return last ? { lastAt: last.effectiveAt, ageHours: (Date.parse(now) - Date.parse(last.effectiveAt)) / 3_600_000 } : null
}
