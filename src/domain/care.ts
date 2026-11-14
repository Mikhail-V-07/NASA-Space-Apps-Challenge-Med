import type { ActorRole, CareEncounter, CareNote, Intervention, InterventionKind, Observation } from '../../contracts/types'

/**
 * Care workflow: concern → encounter → intervention (recorded) → follow-up → outcome → closure.
 *
 * Authority boundary (docs/v3/SYSTEM_DESIGN.md §6): AEGIS records and structures decisions made
 * by people. It never selects a treatment, never marks a protocol as approved and never closes
 * an encounter on its own.
 */

/** Self-care actions an astronaut may record without the medical context. Everything else needs the CMO. */
export const SELF_CARE_KINDS: readonly InterventionKind[] = ['monitoring', 'activity_adjustment']
/** Approved protocol IDs available onboard. Empty: AEGIS ships no clinically approved protocol content. */
export const APPROVED_PROTOCOL_IDS: ReadonlySet<string> = new Set()

const text = (value: string, label: string, max = 2000) => {
  const t = value.trim()
  if (!t) throw new Error(`${label} is required.`)
  if (t.length > max) throw new Error(`${label} is longer than ${max} characters.`)
  return t
}

export function openEncounter(input: { id: string; subjectId: string; origin: CareEncounter['origin']; at: string; byRole: ActorRole; concern: string; trigger: CareEncounter['trigger']; observationIds?: string[] }): CareEncounter {
  return {
    id: input.id, subjectId: input.subjectId, origin: input.origin, openedAt: input.at, openedByRole: input.byRole,
    trigger: input.trigger, concern: text(input.concern, 'Describe the concern'), status: 'open',
    observationIds: [...new Set(input.observationIds ?? [])], notes: [], interventionIds: [],
    demonstrationOnly: input.origin === 'synthetic',
  }
}

function assertWritable(e: CareEncounter) { if (e.status === 'closed') throw new Error('Closed encounters are read-only.') }

export function addNote(e: CareEncounter, note: CareNote): CareEncounter {
  assertWritable(e)
  return { ...e, notes: [...e.notes, { ...note, text: text(note.text, 'Note') }] }
}

/** Links observations as evidence. They must belong to the same subject and data origin. */
export function linkObservations(e: CareEncounter, records: readonly Observation[]): CareEncounter {
  assertWritable(e)
  if (records.some(o => o.subjectId !== e.subjectId || o.origin !== e.origin)) throw new Error('Linked observations must belong to the same person and data workspace.')
  return { ...e, observationIds: [...new Set([...e.observationIds, ...records.map(o => o.id)])] }
}

export interface InterventionInput {
  id: string
  kind: InterventionKind
  description: string
  protocol: Intervention['protocol']
  at: string
  byRole: ActorRole
  followUp: Intervention['followUp']
}

export function recordIntervention(e: CareEncounter, input: InterventionInput): { encounter: CareEncounter; intervention: Intervention } {
  assertWritable(e)
  if (input.byRole === 'system') throw new Error('Interventions are recorded by people, not by AEGIS.')
  if (input.byRole === 'astronaut' && !SELF_CARE_KINDS.includes(input.kind)) throw new Error('This action type must be recorded in the Crew Medical Officer context.')
  if (input.protocol.status === 'approved' && !(input.protocol.reference && APPROVED_PROTOCOL_IDS.has(input.protocol.reference))) throw new Error('No approved protocol with this reference is available onboard. Record it as illustrative or without a protocol.')
  if (input.followUp) {
    if (Date.parse(input.followUp.dueAt) < Date.parse(input.at)) throw new Error('Follow-up must be due after the intervention.')
    if (!input.followUp.parameterIds.length) throw new Error('Choose at least one parameter to re-check at follow-up.')
  }
  const intervention: Intervention = {
    id: input.id, encounterId: e.id, subjectId: e.subjectId, origin: e.origin, kind: input.kind,
    description: text(input.description, 'Describe the action'),
    protocol: input.protocol.reference?.trim() ? { status: input.protocol.status, reference: input.protocol.reference.trim() } : { status: input.protocol.status },
    recordedAt: input.at, recordedByRole: input.byRole,
    followUp: input.followUp ? { dueAt: input.followUp.dueAt, parameterIds: [...new Set(input.followUp.parameterIds)] } : null,
    demonstrationOnly: e.demonstrationOnly || input.protocol.status === 'illustrative',
  }
  return { intervention, encounter: { ...e, status: intervention.followUp ? 'monitoring' : e.status, interventionIds: [...e.interventionIds, intervention.id] } }
}

/** Observations collected for a follow-up: the follow-up parameters, same subject/origin, after the intervention. */
export function followUpEvidence(i: Intervention, observations: readonly Observation[]): Observation[] {
  if (!i.followUp) return []
  const params = new Set(i.followUp.parameterIds)
  return observations.filter(o => o.subjectId === i.subjectId && o.origin === i.origin && params.has(o.parameterId) && o.effectiveAt > i.recordedAt)
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
}

export type FollowUpState = 'none' | 'scheduled' | 'due' | 'evidence_available' | 'assessed'

/** Data-state of a follow-up. 'due' is purely time-based; it says nothing about health. */
export function followUpState(i: Intervention, observations: readonly Observation[], now: string): FollowUpState {
  if (!i.followUp) return 'none'
  if (i.outcome) return 'assessed'
  if (followUpEvidence(i, observations).length) return 'evidence_available'
  return Date.parse(now) >= Date.parse(i.followUp.dueAt) ? 'due' : 'scheduled'
}

export function recordOutcome(i: Intervention, input: { at: string; byRole: ActorRole; result: NonNullable<Intervention['outcome']>['result']; note: string; observationIds: string[] }, observations: readonly Observation[]): Intervention {
  if (i.outcome) throw new Error('Outcome already recorded.')
  if (input.byRole !== 'medical') throw new Error('Outcomes are assessed in the Crew Medical Officer context.')
  const evidence = new Set(followUpEvidence(i, observations).map(o => o.id))
  if (input.result !== 'not_assessable' && (!input.observationIds.length || input.observationIds.some(id => !evidence.has(id)))) throw new Error('Cite at least one follow-up observation recorded after the intervention, or record the outcome as not assessable.')
  return { ...i, outcome: { assessedAt: input.at, byRole: input.byRole, result: input.result, note: text(input.note, 'Outcome note'), observationIds: input.observationIds } }
}

export function closeEncounter(e: CareEncounter, interventions: readonly Intervention[], input: { at: string; byRole: ActorRole; closure: string }): CareEncounter {
  assertWritable(e)
  if (input.byRole !== 'medical') throw new Error('Encounters are closed in the Crew Medical Officer context.')
  const own = interventions.filter(i => i.encounterId === e.id)
  if (own.some(i => i.followUp && !i.outcome)) throw new Error('Record the outcome of every scheduled follow-up before closing.')
  return { ...e, status: 'closed', closedAt: input.at, closure: text(input.closure, 'Closure summary') }
}
