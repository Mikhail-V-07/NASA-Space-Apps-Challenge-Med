import type { ActorRole, CarePlanItem, Observation, PlanCompletion, PlanDomain } from '../../contracts/types'
import { numericValue } from './observations'

/**
 * Preventive management (v3.1): scheduled activities, adherence and linkage to observations.
 *
 * A plan item says WHAT to do and HOW OFTEN; it never carries a clinical target. Content either
 * comes from the ground/CMO (entered by people) or is a project-authored demonstration plan.
 * Adherence is a record of what was done — not an assessment of health.
 */

const HOUR = 3_600_000

export const PLAN_DOMAINS: { id: PlanDomain; label: string }[] = [
  { id: 'measurement', label: 'Measurement' }, { id: 'exercise', label: 'Exercise' }, { id: 'sleep', label: 'Sleep' },
  { id: 'hydration', label: 'Hydration' }, { id: 'nutrition', label: 'Nutrition' }, { id: 'behavioral', label: 'Behavioral health' },
  { id: 'countermeasure', label: 'Countermeasure' },
]

export interface PlanInput { id: string; subjectId: string; domain: PlanDomain; title: string; instructions: string; parameterIds: string[]; everyHours: number; startAt: string; endAt: string | null; source: CarePlanItem['source']; at: string; byRole: ActorRole; encounterId?: string; demonstrationOnly?: boolean }

export function createPlanItem(i: PlanInput): CarePlanItem {
  if (!i.title.trim()) throw new Error('A plan item needs a title.')
  if (!(i.everyHours > 0) || i.everyHours > 24 * 31) throw new Error('Schedule interval must be between 0 and 744 hours.')
  if (i.endAt && i.endAt <= i.startAt) throw new Error('A plan item must end after it starts.')
  if (i.byRole === 'astronaut' && i.source !== 'demonstration') throw new Error('Plan items are defined by the CMO or the ground; crew record completion.')
  if (i.byRole === 'system' && i.source !== 'demonstration') throw new Error('AEGIS only seeds labelled demonstration plans.')
  return {
    id: i.id, subjectId: i.subjectId, domain: i.domain, title: i.title.trim(), instructions: i.instructions.trim(), parameterIds: [...new Set(i.parameterIds)],
    schedule: { everyHours: i.everyHours, startAt: i.startAt, endAt: i.endAt }, status: 'active', source: i.source, createdAt: i.at, createdByRole: i.byRole,
    ...(i.encounterId ? { encounterId: i.encounterId } : {}), demonstrationOnly: i.demonstrationOnly ?? i.source === 'demonstration',
  }
}

/** Scheduled due times in [from, to]. Slot k covers [due_k, due_k + everyHours). */
export function occurrences(item: CarePlanItem, from: string, to: string): string[] {
  const step = item.schedule.everyHours * HOUR, start = Date.parse(item.schedule.startAt)
  const end = Math.min(Date.parse(to), item.schedule.endAt ? Date.parse(item.schedule.endAt) : Infinity)
  const out: string[] = []
  let k = Math.max(0, Math.ceil((Date.parse(from) - start) / step))
  for (let t = start + k * step; t <= end && out.length < 2000; k++, t = start + k * step) out.push(new Date(t).toISOString())
  return out
}

export type OccurrenceStatus = 'done' | 'evidenced' | 'skipped' | 'missed' | 'open' | 'upcoming'
export interface Occurrence { dueAt: string; status: OccurrenceStatus; completionId?: string; observationIds: string[] }

/**
 * Status of each occurrence: an explicit completion record wins; otherwise any usable observation of
 * the plan's parameters in the slot counts as 'evidenced'. A past slot with neither is 'missed';
 * the current slot is 'open'.
 */
export function occurrenceStatus(item: CarePlanItem, completions: readonly PlanCompletion[], observations: readonly Observation[], from: string, now: string): Occurrence[] {
  const step = item.schedule.everyHours * HOUR, params = new Set(item.parameterIds)
  const own = observations.filter(o => o.subjectId === item.subjectId && params.has(o.parameterId) && numericValue(o) !== null)
  return occurrences(item, from, new Date(Date.parse(now) + step).toISOString()).map(dueAt => {
    const s = Date.parse(dueAt), e = s + step
    const c = completions.find(x => x.planItemId === item.id && x.dueAt === dueAt)
    const ev = own.filter(o => { const t = Date.parse(o.effectiveAt); return t >= s && t < e }).map(o => o.id)
    if (c) return { dueAt, status: c.status === 'done' ? 'done' : 'skipped', completionId: c.id, observationIds: c.observationIds.length ? c.observationIds : ev }
    if (ev.length) return { dueAt, status: 'evidenced', observationIds: ev }
    const n = Date.parse(now)
    return { dueAt, status: s > n ? 'upcoming' : e <= n ? 'missed' : 'open', observationIds: [] }
  })
}

export interface Adherence { due: number; done: number; skipped: number; missed: number; fraction: number | null }
/** Adherence over completed slots only (open/upcoming slots are excluded). */
export function adherence(occ: readonly Occurrence[]): Adherence {
  const closed = occ.filter(o => o.status !== 'open' && o.status !== 'upcoming')
  const done = closed.filter(o => o.status === 'done' || o.status === 'evidenced').length
  const skipped = closed.filter(o => o.status === 'skipped').length, missed = closed.filter(o => o.status === 'missed').length
  return { due: closed.length, done, skipped, missed, fraction: closed.length ? done / closed.length : null }
}

export function recordCompletion(item: CarePlanItem, input: { id: string; dueAt: string; at: string; byRole: ActorRole; status: PlanCompletion['status']; observationIds: string[]; note?: string }, observations: readonly Observation[]): PlanCompletion {
  if (item.status !== 'active') throw new Error('This plan item is not active.')
  if (input.byRole === 'system') throw new Error('Completion is recorded by people.')
  if (!occurrences(item, input.dueAt, input.dueAt).includes(input.dueAt)) throw new Error('Not a scheduled occurrence of this plan item.')
  if (input.status === 'skipped' && !input.note?.trim()) throw new Error('Add a short reason when skipping.')
  for (const id of input.observationIds) { const o = observations.find(x => x.id === id); if (!o || o.subjectId !== item.subjectId) throw new Error('Linked observations must be this person’s records.') }
  return { id: input.id, planItemId: item.id, subjectId: item.subjectId, dueAt: input.dueAt, at: input.at, byRole: input.byRole, status: input.status, observationIds: input.observationIds, ...(input.note?.trim() ? { note: input.note.trim() } : {}) }
}

/** Sum of logged amounts per day (e.g. fluid intake). Descriptive; no target. */
export function dailyTotals(records: readonly Observation[]): { day: string; total: number; n: number }[] {
  const m = new Map<string, { total: number; n: number }>()
  for (const o of records) { const v = numericValue(o); if (v === null) continue; const d = o.effectiveAt.slice(0, 10); const x = m.get(d) ?? { total: 0, n: 0 }; x.total += v; x.n++; m.set(d, x) }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, x]) => ({ day, ...x }))
}

/**
 * Demonstration plan set for a crew member. Cadences are illustrative and labelled as such.
 * The exercise entry cites a public description of ISS practice (JAXA: at least 2 h/day) only as
 * context; AEGIS does not prescribe exercise.
 */
export function demonstrationPlans(subjectId: string, startAt: string, newId: () => string, at: string): CarePlanItem[] {
  const base = { subjectId, startAt, endAt: null, source: 'demonstration' as const, at, byRole: 'system' as const }
  return [
    createPlanItem({ ...base, id: newId(), domain: 'measurement', title: 'Morning resting heart rate', instructions: 'Record resting heart rate after waking. Demonstration cadence.', parameterIds: ['resting_hr'], everyHours: 24 }),
    createPlanItem({ ...base, id: newId(), domain: 'sleep', title: 'Log sleep period', instructions: 'Log the duration of the last sleep period.', parameterIds: ['sleep_duration'], everyHours: 24 }),
    createPlanItem({ ...base, id: newId(), domain: 'exercise', title: 'Exercise session log', instructions: 'Log exercise session duration. Context: JAXA describes ISS crews exercising at least 2 h per day; the actual prescription comes from the ground team.', parameterIds: ['exercise_duration'], everyHours: 24 }),
    createPlanItem({ ...base, id: newId(), domain: 'hydration', title: 'Fluid intake log', instructions: 'Log fluid consumed. AEGIS records totals only and sets no target.', parameterIds: ['fluid_intake'], everyHours: 8 }),
    createPlanItem({ ...base, id: newId(), domain: 'behavioral', title: 'Daily self-check', instructions: 'Rate fatigue, mood and stress (descriptive 0–10 scales).', parameterIds: ['fatigue', 'mood', 'stress'], everyHours: 24 }),
  ]
}
