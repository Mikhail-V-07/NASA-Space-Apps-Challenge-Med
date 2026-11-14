import { z } from 'zod'
import type { ActorRole, AuditEntry, Baseline, CareEncounter, HealthMeasurement, HealthWorkspace, Intervention, Observation } from '../../contracts/types'
import { addNote, closeEncounter, linkObservations, openEncounter, recordIntervention, recordOutcome } from './care'
import type { InterventionInput } from './care'
import { fromLegacyAll } from './legacy'
import { observationSchema, validateObservation } from './observations'
import type { Registry } from './registry'
import { proposeBaseline, series } from './series'

/**
 * Health workspace: the v3 store for ONE data origin (observed records). Every command is a pure
 * function returning a new workspace plus an audit entry. Commands enforce subject and role rules;
 * the UI may hide controls, but these checks are the authority (docs/v3/SYSTEM_DESIGN.md §6).
 */

export const emptyWorkspace = (): HealthWorkspace => ({ schemaVersion: 3, observations: [], baselines: [], encounters: [], interventions: [], audit: [] })

export interface Actor { role: ActorRole; /** Astronaut context: the only subject this actor may write. */ subjectId: string | null }
export interface CommandContext { actor: Actor; at: string; newId(): string; registry: Registry }

export type HealthCommand =
  | { type: 'observation/record'; record: Observation }
  | { type: 'baseline/propose'; subjectId: string; parameterId: string; observationIds: string[]; note?: string }
  | { type: 'baseline/accept'; baselineId: string }
  | { type: 'encounter/open'; subjectId: string; concern: string; trigger: CareEncounter['trigger']; observationIds: string[] }
  | { type: 'encounter/note'; encounterId: string; text: string }
  | { type: 'encounter/link'; encounterId: string; observationIds: string[] }
  | { type: 'intervention/record'; encounterId: string; input: Omit<InterventionInput, 'id' | 'at' | 'byRole'> }
  | { type: 'intervention/outcome'; interventionId: string; result: NonNullable<Intervention['outcome']>['result']; note: string; observationIds: string[] }
  | { type: 'encounter/close'; encounterId: string; closure: string }

function assertSubject(actor: Actor, subjectId: string) {
  if (actor.role === 'astronaut' && actor.subjectId !== subjectId) throw new Error('You can only record your own health data.')
}
const find = <T extends { id: string }>(items: readonly T[], id: string, label: string) => { const x = items.find(i => i.id === id); if (!x) throw new Error(`${label} not found.`); return x }

export function applyHealthCommand(ws: HealthWorkspace, cmd: HealthCommand, ctx: CommandContext): HealthWorkspace {
  const { actor, at } = ctx
  const audit = (action: string, recordIds: string[]): AuditEntry => ({ id: ctx.newId(), at, role: actor.role, action, recordIds })
  switch (cmd.type) {
    case 'observation/record': {
      const record = validateObservation(cmd.record, ctx.registry)
      assertSubject(actor, record.subjectId)
      if (record.origin !== 'observed') throw new Error('This workspace stores observed records only.')
      if (ws.observations.some(o => o.id === record.id)) throw new Error('Observation already recorded; corrections are new records.')
      return { ...ws, observations: [...ws.observations, record], audit: [...ws.audit, audit('observation/record', [record.id])] }
    }
    case 'baseline/propose': {
      assertSubject(actor, cmd.subjectId)
      if (actor.role === 'system') throw new Error('Baselines are proposed by people.')
      const chosen = new Set(cmd.observationIds)
      const records = series(ws.observations, { subjectId: cmd.subjectId, parameterId: cmd.parameterId, origin: 'observed' }).filter(o => chosen.has(o.id))
      if (records.length !== chosen.size) throw new Error('Selected readings must be this person’s observed readings of this parameter.')
      const baseline = proposeBaseline(records, { id: ctx.newId(), at, byRole: actor.role, ...(cmd.note ? { note: cmd.note } : {}) })
      return { ...ws, baselines: [...ws.baselines, baseline], audit: [...ws.audit, audit('baseline/propose', [baseline.id])] }
    }
    case 'baseline/accept': {
      if (actor.role !== 'medical') throw new Error('Baselines are accepted in the Crew Medical Officer context.')
      const target = find(ws.baselines, cmd.baselineId, 'Baseline')
      if (target.status !== 'proposed') throw new Error('Only a proposed baseline can be accepted.')
      const baselines = ws.baselines.map<Baseline>(b => b.id === target.id ? { ...b, status: 'accepted' } : b.subjectId === target.subjectId && b.parameterId === target.parameterId && b.status === 'accepted' ? { ...b, status: 'superseded' } : b)
      return { ...ws, baselines, audit: [...ws.audit, audit('baseline/accept', [target.id])] }
    }
    case 'encounter/open': {
      assertSubject(actor, cmd.subjectId)
      const evidence = ws.observations.filter(o => cmd.observationIds.includes(o.id))
      if (evidence.length !== cmd.observationIds.length || evidence.some(o => o.subjectId !== cmd.subjectId)) throw new Error('Evidence must be this person’s recorded observations.')
      const e = openEncounter({ id: ctx.newId(), subjectId: cmd.subjectId, origin: 'observed', at, byRole: actor.role, concern: cmd.concern, trigger: cmd.trigger, observationIds: cmd.observationIds })
      return { ...ws, encounters: [...ws.encounters, e], audit: [...ws.audit, audit('encounter/open', [e.id])] }
    }
    case 'encounter/note': {
      const e = find(ws.encounters, cmd.encounterId, 'Encounter'); assertSubject(actor, e.subjectId)
      const updated = addNote(e, { id: ctx.newId(), at, byRole: actor.role, text: cmd.text })
      return replaceEncounter(ws, updated, audit('encounter/note', [e.id]))
    }
    case 'encounter/link': {
      const e = find(ws.encounters, cmd.encounterId, 'Encounter'); assertSubject(actor, e.subjectId)
      const records = ws.observations.filter(o => cmd.observationIds.includes(o.id))
      if (records.length !== cmd.observationIds.length) throw new Error('Unknown observation.')
      return replaceEncounter(ws, linkObservations(e, records), audit('encounter/link', [e.id, ...cmd.observationIds]))
    }
    case 'intervention/record': {
      const e = find(ws.encounters, cmd.encounterId, 'Encounter'); assertSubject(actor, e.subjectId)
      for (const id of cmd.input.followUp?.parameterIds ?? []) if (ctx.registry.parameter(id)?.status !== 'active') throw new Error(`Follow-up parameter '${id}' cannot be recorded.`)
      const { encounter, intervention } = recordIntervention(e, { ...cmd.input, id: ctx.newId(), at, byRole: actor.role })
      return { ...replaceEncounter(ws, encounter, audit('intervention/record', [e.id, intervention.id])), interventions: [...ws.interventions, intervention] }
    }
    case 'intervention/outcome': {
      const i = find(ws.interventions, cmd.interventionId, 'Intervention')
      const updated = recordOutcome(i, { at, byRole: actor.role, result: cmd.result, note: cmd.note, observationIds: cmd.observationIds }, ws.observations)
      return { ...ws, interventions: ws.interventions.map(x => x.id === i.id ? updated : x), audit: [...ws.audit, audit('intervention/outcome', [i.id])] }
    }
    case 'encounter/close': {
      const e = find(ws.encounters, cmd.encounterId, 'Encounter')
      return replaceEncounter(ws, closeEncounter(e, ws.interventions, { at, byRole: actor.role, closure: cmd.closure }), audit('encounter/close', [e.id]))
    }
  }
}

function replaceEncounter(ws: HealthWorkspace, e: CareEncounter, entry: AuditEntry): HealthWorkspace {
  return { ...ws, encounters: ws.encounters.map(x => x.id === e.id ? e : x), audit: [...ws.audit, entry] }
}

/** Read-only scoping: what an actor may see. Astronauts see only their own records. */
export function visibleTo(ws: HealthWorkspace, actor: Actor): HealthWorkspace {
  if (actor.role !== 'astronaut') return ws
  const own = <T extends { subjectId: string }>(xs: T[]) => xs.filter(x => x.subjectId === actor.subjectId)
  const ids = new Set([...own(ws.observations), ...own(ws.baselines), ...own(ws.encounters), ...own(ws.interventions)].map(x => x.id))
  return { ...ws, observations: own(ws.observations), baselines: own(ws.baselines), encounters: own(ws.encounters), interventions: own(ws.interventions), audit: ws.audit.filter(a => a.recordIds.some(id => ids.has(id))) }
}

/** One-way migration of Core v2 personal measurements into v3 observations. Unmappable records are reported, not dropped silently. */
export function migrateFromV2(measurements: readonly HealthMeasurement[], registry: Registry): { workspace: HealthWorkspace; skipped: string[] } {
  const ws = emptyWorkspace(), skipped: string[] = []
  for (const o of fromLegacyAll(measurements)) {
    try { ws.observations.push(validateObservation(o, registry)) } catch { skipped.push(o.id) }
  }
  for (const m of measurements) if (!ws.observations.some(o => o.id === m.id) && !skipped.includes(m.id)) skipped.push(m.id)
  return { workspace: ws, skipped }
}

const id = z.string().min(1).max(200), ts = z.iso.datetime({ offset: true }), role = z.enum(['astronaut', 'medical', 'system'])
export const workspaceSchema = z.object({
  schemaVersion: z.literal(3),
  observations: z.array(observationSchema),
  baselines: z.array(z.object({ id, subjectId: id, parameterId: id, unitId: id, method: z.enum(['descriptive_median', 'recorded_reference']), value: z.number().finite(), summary: z.object({ n: z.number().int().positive(), min: z.number().finite(), max: z.number().finite() }), observationIds: z.array(id), window: z.object({ from: ts, to: ts }), establishedAt: ts, establishedByRole: z.enum(['astronaut', 'medical']), status: z.enum(['proposed', 'accepted', 'superseded']), note: z.string().optional() })),
  encounters: z.array(z.object({ id, subjectId: id, origin: z.enum(['synthetic', 'observed', 'research_dataset']), openedAt: ts, openedByRole: role, trigger: z.object({ type: z.enum(['self_report', 'observation_review', 'alert', 'scheduled_review']), refIds: z.array(id) }), concern: z.string().min(1), status: z.enum(['open', 'monitoring', 'closed']), observationIds: z.array(id), notes: z.array(z.object({ id, at: ts, byRole: role, text: z.string().min(1) })), interventionIds: z.array(id), closedAt: ts.optional(), closure: z.string().optional(), demonstrationOnly: z.boolean() })),
  interventions: z.array(z.object({ id, encounterId: id, subjectId: id, origin: z.enum(['synthetic', 'observed', 'research_dataset']), kind: z.enum(['monitoring', 'activity_adjustment', 'countermeasure', 'procedure', 'medication', 'escalation']), description: z.string().min(1), protocol: z.object({ status: z.enum(['none', 'illustrative', 'approved']), reference: z.string().optional() }), recordedAt: ts, recordedByRole: role, followUp: z.object({ dueAt: ts, parameterIds: z.array(id) }).nullable(), outcome: z.object({ assessedAt: ts, byRole: role, result: z.enum(['improved', 'unchanged', 'worse', 'not_assessable']), note: z.string().min(1), observationIds: z.array(id) }).optional(), demonstrationOnly: z.boolean() })),
  audit: z.array(z.object({ id, at: ts, role, action: z.string().min(1), recordIds: z.array(id) })),
})

/** Validates a stored workspace, including registry rules for every observation and referential integrity. */
export function parseWorkspace(input: unknown, registry: Registry): HealthWorkspace {
  const ws = workspaceSchema.parse(input) as HealthWorkspace
  for (const o of ws.observations) validateObservation(o, registry)
  const obs = new Set(ws.observations.map(o => o.id)), enc = new Set(ws.encounters.map(e => e.id))
  if (obs.size !== ws.observations.length) throw new Error('Duplicate observation ID.')
  for (const e of ws.encounters) if (e.observationIds.some(x => !obs.has(x))) throw new Error('Encounter references a missing observation.')
  for (const i of ws.interventions) if (!enc.has(i.encounterId)) throw new Error('Intervention references a missing encounter.')
  for (const b of ws.baselines) if (b.observationIds.some(x => !obs.has(x))) throw new Error('Baseline references a missing observation.')
  return ws
}
