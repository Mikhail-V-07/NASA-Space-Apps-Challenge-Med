import { z } from 'zod'
import type { ActorRole, AttentionState, AuditEntry, Baseline, BaselinePolicy, CareEncounter, CarePlanItem, DataOrigin, DecisionRecord, EncounterPriority, HealthMeasurement, HealthWorkspace, Intervention, InventoryItem, MissionProfile, Observation, PlanDomain, ProfileEntry, SymptomEntry } from '../../contracts/types'
import { computeBaseline } from './baselines'
import { advanceProtocol, protocolById, recordDecision, recordFinding, recordIntake, setPriority, startProtocol } from './clinical'
import { composeGroundMessage, useResource } from './mission'
import { createPlanItem, recordCompletion } from './prevention'
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

export const emptyWorkspace = (): HealthWorkspace => ({ schemaVersion: 3, observations: [], baselines: [], encounters: [], interventions: [], audit: [], profile: [], plans: [], completions: [], attention: [], intakes: [], findings: [], protocolRuns: [], decisions: [], messages: [], resources: [], resourceUses: [] })

export interface Actor { role: ActorRole; /** Astronaut context: the only subject this actor may write. */ subjectId: string | null }
export interface CommandContext {
  actor: Actor; at: string; newId(): string; registry: Registry
  /** Data origin this workspace holds. Default 'observed'; the simulator workspace uses 'synthetic'. */
  origin?: DataOrigin
  /** Mission context, needed for ground messages. */
  mission?: MissionProfile
}

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
  // v3.1
  | { type: 'baseline/compute'; subjectId: string; parameterId: string; policy: BaselinePolicy; note?: string }
  | { type: 'profile/add'; subjectId: string; kind: ProfileEntry['kind']; text: string }
  | { type: 'profile/resolve'; entryId: string }
  | { type: 'plan/create'; subjectId: string; domain: PlanDomain; title: string; instructions: string; parameterIds: string[]; everyHours: number; startAt: string; endAt: string | null; source: CarePlanItem['source']; encounterId?: string }
  | { type: 'plan/seed'; items: CarePlanItem[] }
  | { type: 'plan/status'; planItemId: string; status: CarePlanItem['status'] }
  | { type: 'plan/complete'; planItemId: string; dueAt: string; status: 'done' | 'skipped'; observationIds: string[]; note?: string }
  | { type: 'attention/set'; itemId: string; subjectId: string; status: AttentionState['status']; encounterId?: string; note?: string }
  | { type: 'encounter/priority'; encounterId: string; priority: EncounterPriority }
  | { type: 'intake/record'; encounterId: string; symptoms: SymptomEntry[]; history?: string; medications?: string; allergies?: string }
  | { type: 'finding/record'; encounterId: string; area: string; finding: string }
  | { type: 'protocol/start'; encounterId: string; protocolId: string }
  | { type: 'protocol/advance'; runId: string; status: 'done' | 'skipped'; optionId?: string; note?: string; observationIds: string[]; safetyIssues: string[] }
  | { type: 'decision/record'; encounterId: string; recommendation: DecisionRecord['recommendation']; decision: DecisionRecord['decision']; rationale: string }
  | { type: 'message/send'; subjectId: string; encounterId?: string; summary: string; recordIds: string[] }
  | { type: 'resources/seed'; resources: InventoryItem[] }
  | { type: 'resource/use'; resourceId: string; quantity: number; subjectId: string; encounterId?: string; interventionId?: string }

function assertSubject(actor: Actor, subjectId: string) {
  if (actor.role === 'astronaut' && actor.subjectId !== subjectId) throw new Error('You can only record your own health data.')
}
const find = <T extends { id: string }>(items: readonly T[], id: string, label: string) => { const x = items.find(i => i.id === id); if (!x) throw new Error(`${label} not found.`); return x }

export function applyHealthCommand(ws: HealthWorkspace, cmd: HealthCommand, ctx: CommandContext): HealthWorkspace {
  const { actor, at } = ctx
  const origin = ctx.origin ?? 'observed'
  const audit = (action: string, recordIds: string[]): AuditEntry => ({ id: ctx.newId(), at, role: actor.role, action, recordIds })
  const log = (next: Partial<HealthWorkspace>, action: string, ids: string[]): HealthWorkspace => ({ ...ws, ...next, audit: [...ws.audit, audit(action, ids)] })
  const openEnc = (id: string) => { const e = find(ws.encounters, id, 'Encounter'); assertSubject(actor, e.subjectId); return e }
  switch (cmd.type) {
    case 'observation/record': {
      const record = validateObservation(cmd.record, ctx.registry)
      assertSubject(actor, record.subjectId)
      if (record.origin !== origin) throw new Error(`This workspace stores ${origin} records only.`)
      if (ws.observations.some(o => o.id === record.id)) throw new Error('Observation already recorded; corrections are new records.')
      return { ...ws, observations: [...ws.observations, record], audit: [...ws.audit, audit('observation/record', [record.id])] }
    }
    case 'baseline/propose': {
      assertSubject(actor, cmd.subjectId)
      if (actor.role === 'system') throw new Error('Baselines are proposed by people.')
      const chosen = new Set(cmd.observationIds)
      const records = series(ws.observations, { subjectId: cmd.subjectId, parameterId: cmd.parameterId, origin }).filter(o => chosen.has(o.id))
      if (records.length !== chosen.size) throw new Error('Selected readings must be this person’s observed readings of this parameter.')
      const existing = ws.baselines.filter(b => b.subjectId === cmd.subjectId && b.parameterId === cmd.parameterId)
      const prior = existing.filter(b => b.status !== 'superseded').at(-1)
      const proposed = proposeBaseline(records, { id: ctx.newId(), at, byRole: actor.role, ...(cmd.note ? { note: cmd.note } : {}) })
      const baseline: Baseline = { ...proposed, version: (existing.at(-1)?.version ?? existing.length) + 1, policy: { method: 'median', minReadings: records.length, dataset: { type: 'selected', observationIds: proposed.observationIds } }, ...(prior ? { supersedesId: prior.id } : {}) }
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
      const e = openEncounter({ id: ctx.newId(), subjectId: cmd.subjectId, origin, at, byRole: actor.role, concern: cmd.concern, trigger: cmd.trigger, observationIds: cmd.observationIds })
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
    case 'baseline/compute': {
      assertSubject(actor, cmd.subjectId)
      if (actor.role === 'system') throw new Error('Baselines are proposed by people.')
      const recs = series(ws.observations, { subjectId: cmd.subjectId, parameterId: cmd.parameterId, origin })
      const b = computeBaseline(recs, cmd.policy, { id: ctx.newId(), at, byRole: actor.role, existing: ws.baselines, ...(cmd.note ? { note: cmd.note } : {}) })
      return log({ baselines: [...ws.baselines, b] }, 'baseline/compute', [b.id])
    }
    case 'profile/add': {
      assertSubject(actor, cmd.subjectId)
      if (actor.role === 'system') throw new Error('Profile entries are recorded by people.')
      if (!cmd.text.trim()) throw new Error('Describe the entry.')
      if ((cmd.kind === 'preflight_result' || cmd.kind === 'risk_factor') && actor.role !== 'medical') throw new Error('Pre-flight results and risk factors are recorded in the CMO context.')
      const entry: ProfileEntry = { id: ctx.newId(), subjectId: cmd.subjectId, kind: cmd.kind, text: cmd.text.trim(), recordedAt: at, byRole: actor.role, status: 'active', demonstrationOnly: origin === 'synthetic' }
      return log({ profile: [...ws.profile, entry] }, 'profile/add', [entry.id])
    }
    case 'profile/resolve': {
      const p = find(ws.profile, cmd.entryId, 'Profile entry'); assertSubject(actor, p.subjectId)
      if (actor.role !== 'medical') throw new Error('Profile entries are resolved in the CMO context.')
      return log({ profile: ws.profile.map(x => x.id === p.id ? { ...x, status: 'resolved' } : x) }, 'profile/resolve', [p.id])
    }
    case 'plan/create': {
      if (actor.role !== 'medical') throw new Error('Plan items are defined in the CMO context.')
      if (cmd.encounterId) find(ws.encounters, cmd.encounterId, 'Encounter')
      for (const id of cmd.parameterIds) if (ctx.registry.parameter(id)?.status !== 'active') throw new Error(`Parameter '${id}' cannot be recorded.`)
      const item = createPlanItem({ id: ctx.newId(), subjectId: cmd.subjectId, domain: cmd.domain, title: cmd.title, instructions: cmd.instructions, parameterIds: cmd.parameterIds, everyHours: cmd.everyHours, startAt: cmd.startAt, endAt: cmd.endAt, source: cmd.source, at, byRole: actor.role, ...(cmd.encounterId ? { encounterId: cmd.encounterId } : {}), demonstrationOnly: origin === 'synthetic' || cmd.source === 'demonstration' })
      return log({ plans: [...ws.plans, item] }, 'plan/create', [item.id, ...(cmd.encounterId ? [cmd.encounterId] : [])])
    }
    case 'plan/seed': {
      if (cmd.items.some(i => i.source !== 'demonstration' || !i.demonstrationOnly)) throw new Error('Only labelled demonstration plans can be seeded.')
      const fresh = cmd.items.filter(i => !ws.plans.some(p => p.id === i.id))
      return log({ plans: [...ws.plans, ...fresh] }, 'plan/seed', fresh.map(i => i.id))
    }
    case 'plan/status': {
      if (actor.role !== 'medical') throw new Error('Plan items are changed in the CMO context.')
      const p = find(ws.plans, cmd.planItemId, 'Plan item')
      return log({ plans: ws.plans.map(x => x.id === p.id ? { ...x, status: cmd.status } : x) }, `plan/${cmd.status}`, [p.id])
    }
    case 'plan/complete': {
      const p = find(ws.plans, cmd.planItemId, 'Plan item'); assertSubject(actor, p.subjectId)
      if (ws.completions.some(c => c.planItemId === p.id && c.dueAt === cmd.dueAt)) throw new Error('This occurrence is already recorded.')
      const c = recordCompletion(p, { id: ctx.newId(), dueAt: cmd.dueAt, at, byRole: actor.role, status: cmd.status, observationIds: cmd.observationIds, ...(cmd.note ? { note: cmd.note } : {}) }, ws.observations)
      return log({ completions: [...ws.completions, c] }, 'plan/complete', [c.id, p.id])
    }
    case 'attention/set': {
      assertSubject(actor, cmd.subjectId)
      if (actor.role === 'system') throw new Error('Attention items are handled by people.')
      if (cmd.status === 'dismissed' && actor.role !== 'medical') throw new Error('Only the CMO can dismiss an item.')
      if (cmd.status === 'linked') { const e = find(ws.encounters, cmd.encounterId ?? '', 'Encounter'); if (e.subjectId !== cmd.subjectId) throw new Error('Link to an encounter for the same person.') }
      if (cmd.status === 'dismissed' && !cmd.note?.trim()) throw new Error('Give a reason for dismissing.')
      const st: AttentionState = { itemId: cmd.itemId, status: cmd.status, at, byRole: actor.role, ...(cmd.encounterId ? { encounterId: cmd.encounterId } : {}), ...(cmd.note?.trim() ? { note: cmd.note.trim() } : {}) }
      return log({ attention: [...ws.attention, st] }, `attention/${cmd.status}`, [cmd.itemId, ...(cmd.encounterId ? [cmd.encounterId] : [])])
    }
    case 'encounter/priority': {
      const e = openEnc(cmd.encounterId)
      return replaceEncounter(ws, setPriority(e, cmd.priority, actor.role), audit(`encounter/priority:${cmd.priority}`, [e.id]))
    }
    case 'intake/record': {
      const e = openEnc(cmd.encounterId)
      const i = recordIntake(e, { id: ctx.newId(), at, byRole: actor.role, symptoms: cmd.symptoms, ...(cmd.history !== undefined ? { history: cmd.history } : {}), ...(cmd.medications !== undefined ? { medications: cmd.medications } : {}), ...(cmd.allergies !== undefined ? { allergies: cmd.allergies } : {}) })
      return log({ intakes: [...ws.intakes, i] }, 'intake/record', [i.id, e.id])
    }
    case 'finding/record': {
      const e = openEnc(cmd.encounterId)
      const f = recordFinding(e, { id: ctx.newId(), at, byRole: actor.role, area: cmd.area, finding: cmd.finding })
      return log({ findings: [...ws.findings, f] }, 'finding/record', [f.id, e.id])
    }
    case 'protocol/start': {
      const e = openEnc(cmd.encounterId)
      const p = protocolById(cmd.protocolId); if (!p) throw new Error('Unknown protocol.')
      const r = startProtocol(e, p, { id: ctx.newId(), at, byRole: actor.role }, ws.protocolRuns)
      const enc = p.priority === 'emergency' ? { ...e, priority: 'emergency' as const } : e
      return { ...replaceEncounter(ws, enc, audit('protocol/start', [r.id, e.id])), protocolRuns: [...ws.protocolRuns, r] }
    }
    case 'protocol/advance': {
      const r = find(ws.protocolRuns, cmd.runId, 'Protocol run'); const e = openEnc(r.encounterId)
      if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
      const p = protocolById(r.protocolId); if (!p) throw new Error('Unknown protocol.')
      const next = advanceProtocol(r, p, { at, byRole: actor.role, status: cmd.status, observationIds: cmd.observationIds, safetyIssues: cmd.safetyIssues, ...(cmd.optionId ? { optionId: cmd.optionId } : {}), ...(cmd.note ? { note: cmd.note } : {}) })
      return log({ protocolRuns: ws.protocolRuns.map(x => x.id === r.id ? next : x) }, 'protocol/step', [r.id, e.id])
    }
    case 'decision/record': {
      const e = openEnc(cmd.encounterId)
      const d = recordDecision(e, { id: ctx.newId(), at, byRole: actor.role, recommendation: cmd.recommendation, decision: cmd.decision, rationale: cmd.rationale })
      return log({ decisions: [...ws.decisions, d] }, `decision/${d.decision}`, [d.id, e.id])
    }
    case 'message/send': {
      assertSubject(actor, cmd.subjectId)
      if (!ctx.mission) throw new Error('No mission profile configured.')
      if (cmd.encounterId) find(ws.encounters, cmd.encounterId, 'Encounter')
      const m = composeGroundMessage(ctx.mission, { id: ctx.newId(), subjectId: cmd.subjectId, at, byRole: actor.role, summary: cmd.summary, recordIds: cmd.recordIds, ...(cmd.encounterId ? { encounterId: cmd.encounterId } : {}) })
      return log({ messages: [...ws.messages, m] }, 'message/send', [m.id, ...(cmd.encounterId ? [cmd.encounterId] : [])])
    }
    case 'resources/seed': {
      if (cmd.resources.some(r => !r.demonstrationOnly)) throw new Error('Only labelled demonstration inventory can be seeded.')
      const fresh = cmd.resources.filter(r => !ws.resources.some(x => x.id === r.id))
      return log({ resources: [...ws.resources, ...fresh] }, 'resources/seed', fresh.map(r => r.id))
    }
    case 'resource/use': {
      const r = find(ws.resources, cmd.resourceId, 'Resource')
      if (cmd.encounterId) { const e = find(ws.encounters, cmd.encounterId, 'Encounter'); if (e.subjectId !== cmd.subjectId) throw new Error('Encounter belongs to another person.') }
      const { resource, uses } = useResource(r, { quantity: cmd.quantity, at, byRole: actor.role, subjectId: cmd.subjectId, newId: ctx.newId, ...(cmd.encounterId ? { encounterId: cmd.encounterId } : {}), ...(cmd.interventionId ? { interventionId: cmd.interventionId } : {}) })
      const interventions = cmd.interventionId ? ws.interventions.map(i => i.id === cmd.interventionId ? { ...i, resourceUseIds: [...(i.resourceUseIds ?? []), ...uses.map(u => u.id)] } : i) : ws.interventions
      return log({ resources: ws.resources.map(x => x.id === r.id ? resource : x), resourceUses: [...ws.resourceUses, ...uses], interventions }, 'resource/use', [r.id, ...uses.map(u => u.id)])
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
  const encounters = own(ws.encounters), encIds = new Set(encounters.map(e => e.id))
  const byEnc = <T extends { encounterId: string }>(xs: T[]) => xs.filter(x => encIds.has(x.encounterId))
  const scoped = { observations: own(ws.observations), baselines: own(ws.baselines), encounters, interventions: own(ws.interventions), profile: own(ws.profile), plans: own(ws.plans), completions: own(ws.completions), intakes: byEnc(ws.intakes), findings: byEnc(ws.findings), protocolRuns: byEnc(ws.protocolRuns), decisions: byEnc(ws.decisions), messages: own(ws.messages), resourceUses: own(ws.resourceUses) }
  const ids = new Set(Object.values(scoped).flatMap(xs => (xs as { id: string }[]).map(x => x.id)))
  const attention = ws.attention.filter(a => a.itemId.split(':')[1] === actor.subjectId)
  for (const a of attention) ids.add(a.itemId)
  return { ...ws, ...scoped, attention, audit: ws.audit.filter(a => a.recordIds.some(id => ids.has(id))) }
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

const id = z.string().min(1).max(200), ts = z.iso.datetime({ offset: true }), role = z.enum(['astronaut', 'medical', 'system']), originE = z.enum(['synthetic', 'observed', 'research_dataset'])
const str = (max = 4000) => z.string().max(max)
const policySchema = z.object({ method: z.enum(['median', 'mean']), minReadings: z.number().int().min(1), dataset: z.discriminatedUnion('type', [z.object({ type: z.literal('last_n'), n: z.number().int().positive() }), z.object({ type: z.literal('window'), from: ts, to: ts }), z.object({ type: z.literal('selected'), observationIds: z.array(id) })]) })
const list = <T extends z.ZodTypeAny>(t: T) => z.array(t).default([])
export const workspaceSchema = z.object({
  schemaVersion: z.literal(3),
  observations: z.array(observationSchema),
  baselines: z.array(z.object({ id, subjectId: id, parameterId: id, unitId: id, method: z.enum(['descriptive_median', 'descriptive_mean', 'recorded_reference']), value: z.number().finite(), summary: z.object({ n: z.number().int().positive(), min: z.number().finite(), max: z.number().finite() }), observationIds: z.array(id), window: z.object({ from: ts, to: ts }), establishedAt: ts, establishedByRole: z.enum(['astronaut', 'medical']), status: z.enum(['proposed', 'accepted', 'superseded']), note: z.string().optional(), version: z.number().int().positive().optional(), supersedesId: id.optional(), policy: policySchema.optional() })),
  encounters: z.array(z.object({ id, subjectId: id, origin: originE, openedAt: ts, openedByRole: role, trigger: z.object({ type: z.enum(['self_report', 'observation_review', 'alert', 'scheduled_review', 'attention_item', 'preventive_review']), refIds: z.array(z.string().min(1).max(400)) }), concern: z.string().min(1), status: z.enum(['open', 'monitoring', 'closed']), priority: z.enum(['routine', 'urgent', 'emergency']).optional(), observationIds: z.array(id), notes: z.array(z.object({ id, at: ts, byRole: role, text: z.string().min(1) })), interventionIds: z.array(id), closedAt: ts.optional(), closure: z.string().optional(), demonstrationOnly: z.boolean() })),
  interventions: z.array(z.object({ id, encounterId: id, subjectId: id, origin: originE, kind: z.enum(['monitoring', 'activity_adjustment', 'countermeasure', 'procedure', 'medication', 'escalation']), description: z.string().min(1), protocol: z.object({ status: z.enum(['none', 'illustrative', 'approved']), reference: z.string().optional() }), recordedAt: ts, recordedByRole: role, resourceUseIds: z.array(id).optional(), followUp: z.object({ dueAt: ts, parameterIds: z.array(id) }).nullable(), outcome: z.object({ assessedAt: ts, byRole: role, result: z.enum(['improved', 'unchanged', 'worse', 'not_assessable']), note: z.string().min(1), observationIds: z.array(id) }).optional(), demonstrationOnly: z.boolean() })),
  audit: z.array(z.object({ id, at: ts, role, action: z.string().min(1), recordIds: z.array(z.string().min(1).max(400)) })),
  profile: list(z.object({ id, subjectId: id, kind: z.enum(['history', 'risk_factor', 'limitation', 'preflight_result', 'allergy', 'medication']), text: str().min(1), recordedAt: ts, byRole: role, status: z.enum(['active', 'resolved']), demonstrationOnly: z.boolean() })),
  plans: list(z.object({ id, subjectId: id, domain: z.enum(['measurement', 'exercise', 'sleep', 'hydration', 'nutrition', 'behavioral', 'countermeasure']), title: str(200).min(1), instructions: str(), parameterIds: z.array(id), schedule: z.object({ everyHours: z.number().positive(), startAt: ts, endAt: ts.nullable() }), status: z.enum(['active', 'paused', 'ended']), source: z.enum(['ground_prescribed', 'cmo', 'demonstration']), createdAt: ts, createdByRole: role, encounterId: id.optional(), demonstrationOnly: z.boolean() })),
  completions: list(z.object({ id, planItemId: id, subjectId: id, dueAt: ts, at: ts, byRole: role, status: z.enum(['done', 'skipped']), observationIds: z.array(id), note: str().optional() })),
  attention: list(z.object({ itemId: z.string().min(1).max(2000), status: z.enum(['acknowledged', 'linked', 'dismissed']), encounterId: id.optional(), at: ts, byRole: role, note: str().optional() })),
  intakes: list(z.object({ id, encounterId: id, at: ts, byRole: role, symptoms: z.array(z.object({ label: str(200).min(1), bodyRegion: str(200).optional(), onsetAt: ts.optional(), severity: z.number().int().min(0).max(10).optional(), character: str(500).optional(), associated: str(500).optional() })), history: str().optional(), medications: str().optional(), allergies: str().optional() })),
  findings: list(z.object({ id, encounterId: id, at: ts, byRole: role, area: str(200).min(1), finding: str().min(1) })),
  protocolRuns: list(z.object({ id, encounterId: id, protocolId: id, protocolVersion: z.number().int().positive(), protocolStatus: z.enum(['illustrative', 'approved']), startedAt: ts, byRole: role, currentStepId: id.nullable(), steps: z.array(z.object({ stepId: id, status: z.enum(['done', 'skipped']), at: ts, byRole: role, optionId: id.optional(), note: str().optional(), observationIds: z.array(id), safetyIssues: z.array(str()) })), status: z.enum(['active', 'completed', 'abandoned']) })),
  decisions: list(z.object({ id, encounterId: id, at: ts, byRole: role, recommendation: z.object({ source: z.enum(['protocol_step', 'attention_item', 'assistant']), refId: z.string().min(1).max(2000), text: str().min(1), evidenceIds: z.array(id), limitations: z.array(str()) }), decision: z.enum(['accepted', 'declined', 'modified']), rationale: str() })),
  messages: list(z.object({ id, subjectId: id, encounterId: id.optional(), createdAt: ts, byRole: role, summary: str().min(1), recordIds: z.array(id), channel: z.literal('store_and_forward'), deliverAt: ts })),
  resources: list(z.object({ id, name: str(200).min(1), category: z.enum(['medication', 'consumable', 'equipment', 'diagnostic']), unit: str(50), lots: z.array(z.object({ lotId: id, quantity: z.number().min(0), expiresAt: ts.nullable() })), status: z.enum(['available', 'maintenance', 'unavailable']), location: str(200), capabilityTags: z.array(id), note: str().optional(), demonstrationOnly: z.boolean() })),
  resourceUses: list(z.object({ id, resourceId: id, lotId: id, quantity: z.number().positive(), at: ts, byRole: role, subjectId: id, encounterId: id.optional(), interventionId: id.optional() })),
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
  const plans = new Set(ws.plans.map(p => p.id))
  for (const c of ws.completions) if (!plans.has(c.planItemId)) throw new Error('Plan completion references a missing plan item.')
  for (const x of [...ws.intakes, ...ws.findings, ...ws.protocolRuns, ...ws.decisions]) if (!enc.has(x.encounterId)) throw new Error('Clinical record references a missing encounter.')
  return ws
}
