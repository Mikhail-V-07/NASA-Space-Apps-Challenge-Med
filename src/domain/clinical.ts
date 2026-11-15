import type { ActorRole, CareEncounter, ClinicalIntake, DecisionRecord, EncounterPriority, ExamFinding, HealthWorkspace, InventoryItem, MissionProfile, ProtocolDefinition, ProtocolRun, ProtocolStep, SymptomEntry } from '../../contracts/types'
import { availableQuantity, crewWith, resourcesFor, roundTripMinutes } from './mission'
import { numericValue } from './observations'

/**
 * Clinical decision-support FRAMEWORK (v3.1).
 *
 * Provides structure for a human-led encounter: intake, examination record, protocol-guided
 * workflow, safety checks, recorded decisions, escalation and emergency mode. The protocols below
 * are ILLUSTRATIVE WORKFLOWS: they contain steps such as "record vital signs" or "contact the
 * ground", modelled on the scenario structure in HRP-48033 and IWS 2025. They contain no
 * diagnostic criteria, no thresholds, no drugs and no doses, and they cannot be marked approved.
 */

const text = (v: string | undefined, label: string, max = 2000) => { const t = (v ?? '').trim(); if (!t) throw new Error(`${label} is required.`); if (t.length > max) throw new Error(`${label} is too long.`); return t }

export function recordIntake(e: CareEncounter, input: { id: string; at: string; byRole: ActorRole; symptoms: SymptomEntry[]; history?: string; medications?: string; allergies?: string }): ClinicalIntake {
  if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
  if (input.byRole === 'system') throw new Error('Intake is recorded by people.')
  const symptoms = input.symptoms.filter(s => s.label.trim()).map(s => {
    if (s.severity !== undefined && (!Number.isInteger(s.severity) || s.severity < 0 || s.severity > 10)) throw new Error('Self-rated severity uses whole numbers 0–10.')
    return Object.fromEntries(Object.entries({ ...s, label: s.label.trim() }).filter(([, v]) => v !== undefined && v !== '')) as unknown as SymptomEntry
  })
  if (!symptoms.length && !input.history?.trim()) throw new Error('Record at least one symptom or a history note.')
  const opt = (k: 'history' | 'medications' | 'allergies') => input[k]?.trim() ? { [k]: input[k]!.trim() } : {}
  return { id: input.id, encounterId: e.id, at: input.at, byRole: input.byRole, symptoms, ...opt('history'), ...opt('medications'), ...opt('allergies') }
}

export function recordFinding(e: CareEncounter, input: { id: string; at: string; byRole: ActorRole; area: string; finding: string }): ExamFinding {
  if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
  if (input.byRole !== 'medical') throw new Error('Examination findings are recorded in the Crew Medical Officer context.')
  return { id: input.id, encounterId: e.id, at: input.at, byRole: input.byRole, area: text(input.area, 'Body area or system', 200), finding: text(input.finding, 'Finding') }
}

// ── Illustrative protocols (workflow structure only) ──

const step = (s: ProtocolStep) => s
export const PROTOCOLS: ProtocolDefinition[] = [
  {
    id: 'ILL-GEN-ASSESS', title: 'General symptom assessment (illustrative workflow)', version: 1, status: 'illustrative', priority: 'routine', startStepId: 'intake',
    purpose: 'Structure a routine encounter: collect, measure, examine, decide with the ground, follow up.',
    applicability: 'Any non-emergency concern. Contains no clinical criteria.', sourceRefIds: ['hrp-48033', 'iws-2025-eimo', 'nasa-std-3001-v1'],
    steps: [
      step({ id: 'intake', kind: 'collect', title: 'Record symptoms and history', guidance: 'Use the intake form. Record the person’s own words; do not interpret.', nextStepId: 'vitals' }),
      step({ id: 'vitals', kind: 'measure', title: 'Record vital signs', guidance: 'Record the measurements available on board and link them to this encounter.', parameterIds: ['hr', 'sbp', 'dbp', 'spo2', 'rr', 'skin_temp'], requiredResourceTags: ['blood_pressure', 'spo2'], nextStepId: 'exam' }),
      step({ id: 'exam', kind: 'assess', title: 'Record examination findings', guidance: 'Document what was examined and what was observed.', requiredQualification: 'crew_medical_officer', nextStepId: 'consult' }),
      step({ id: 'consult', kind: 'decide', title: 'Decide on ground consultation', guidance: 'Choose whether to send a summary to the ground team now. Consider the current communication delay.', options: [{ id: 'send', label: 'Send summary to ground', nextStepId: 'plan' }, { id: 'defer', label: 'Proceed onboard; send at next window', nextStepId: 'plan' }] }),
      step({ id: 'plan', kind: 'act', title: 'Record actions taken', guidance: 'Record any action decided by the CMO or the ground as an intervention, with a follow-up.', nextStepId: 'reassess' }),
      step({ id: 'reassess', kind: 'reassess', title: 'Schedule reassessment', guidance: 'Set the follow-up time and the parameters to re-check.', nextStepId: null }),
    ],
  },
  {
    id: 'ILL-EMERG', title: 'Emergency response coordination (illustrative workflow)', version: 1, status: 'illustrative', priority: 'emergency', startStepId: 'call',
    purpose: 'Coordinate people and equipment in an emergency. Medical actions follow the mission’s approved procedures, which AEGIS does not contain.',
    applicability: 'Any emergency. AEGIS provides a checklist frame and timestamps only.', sourceRefIds: ['hrp-48033', 'nasa-std-3001-v1'],
    steps: [
      step({ id: 'call', kind: 'act', title: 'Alert the crew and assign roles', guidance: 'Call for help. Identify who leads care, who assists, who records.', nextStepId: 'procedures' }),
      step({ id: 'procedures', kind: 'act', title: 'Open the mission’s approved emergency procedures', guidance: 'Follow the onboard approved procedures. AEGIS records timing and actions only.', requiredQualification: 'basic_life_support', requiredResourceTags: ['ecg_monitor', 'ecg_electrodes'], nextStepId: 'record' }),
      step({ id: 'record', kind: 'measure', title: 'Record available measurements', guidance: 'Record what is measured, when. Missing measurements are recorded as missing.', parameterIds: ['hr', 'spo2', 'sbp', 'dbp', 'rr'], nextStepId: 'ground' }),
      step({ id: 'ground', kind: 'escalate', title: 'Notify the ground', guidance: 'Send a situation summary. With a communication delay, do not wait for a reply before acting on approved procedures.', nextStepId: 'reassess' }),
      step({ id: 'reassess', kind: 'reassess', title: 'Reassess and document', guidance: 'Record the situation at the end of the response and schedule follow-up.', nextStepId: null }),
    ],
  },
  {
    id: 'ILL-PREV-REVIEW', title: 'Preventive plan review (illustrative workflow)', version: 1, status: 'illustrative', priority: 'routine', startStepId: 'review',
    purpose: 'Review adherence and trends with the crew member and adjust the plan.',
    applicability: 'Escalation from preventive management to the CMO.', sourceRefIds: ['nasa-std-3001-v1'],
    steps: [
      step({ id: 'review', kind: 'collect', title: 'Review plan adherence and recent trends', guidance: 'Look at the Prevention and Analytics tabs with the crew member.', nextStepId: 'discuss' }),
      step({ id: 'discuss', kind: 'decide', title: 'Agree changes', guidance: 'Decide with the crew member (and the ground if needed) whether to change the plan.', options: [{ id: 'change', label: 'Change the plan', nextStepId: 'update' }, { id: 'keep', label: 'Keep the plan', nextStepId: 'followup' }] }),
      step({ id: 'update', kind: 'act', title: 'Update plan items', guidance: 'Create or pause plan items in the Prevention tab, linked to this encounter.', nextStepId: 'followup' }),
      step({ id: 'followup', kind: 'reassess', title: 'Schedule follow-up review', guidance: 'Record a monitoring intervention with a follow-up date.', nextStepId: null }),
    ],
  },
]
export const protocolById = (id: string, list: readonly ProtocolDefinition[] = PROTOCOLS) => list.find(p => p.id === id)

export function protocolProblems(p: ProtocolDefinition, approvedIds: ReadonlySet<string>): string[] {
  const out: string[] = [], ids = new Set(p.steps.map(s => s.id))
  if (!ids.has(p.startStepId)) out.push('Start step missing.')
  for (const s of p.steps) for (const n of [s.nextStepId, ...(s.options ?? []).map(o => o.nextStepId)]) if (n && !ids.has(n)) out.push(`Step ${s.id} points to unknown step ${n}.`)
  if (p.status === 'approved' && !approvedIds.has(p.id)) out.push('Only protocols approved by the mission medical authority may be marked approved.')
  return out
}

export function startProtocol(e: CareEncounter, p: ProtocolDefinition, input: { id: string; at: string; byRole: ActorRole }, existing: readonly ProtocolRun[]): ProtocolRun {
  if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
  if (input.byRole !== 'medical') throw new Error('Protocols are run in the Crew Medical Officer context.')
  if (existing.some(r => r.encounterId === e.id && r.protocolId === p.id && r.status === 'active')) throw new Error('This protocol is already running for this encounter.')
  return { id: input.id, encounterId: e.id, protocolId: p.id, protocolVersion: p.version, protocolStatus: p.status, startedAt: input.at, byRole: input.byRole, currentStepId: p.startStepId, steps: [], status: 'active' }
}

export interface SafetyCheck { ok: boolean; issues: string[]; notes: string[] }

/**
 * Checks around a protocol step: protocol status, needed equipment, crew qualification and
 * communication context. Issues are surfaced to the person; they do not block, because the
 * human decides (an issue can be acknowledged in the step note).
 */
export function safetyCheck(p: ProtocolDefinition, s: ProtocolStep, ctx: { resources: readonly InventoryItem[]; mission: MissionProfile; now: string; ws: HealthWorkspace; encounter: CareEncounter }): SafetyCheck {
  const issues: string[] = [], notes: string[] = []
  if (p.status !== 'approved') notes.push('Illustrative workflow: not an approved medical protocol.')
  for (const t of resourcesFor(s.requiredResourceTags ?? [], ctx.resources, ctx.now)) {
    if (!t.resources.length) {
      const any = ctx.resources.filter(r => r.capabilityTags.includes(t.tag))
      issues.push(any.length ? `Equipment for '${t.tag}' is not usable now (${any.map(r => `${r.name}: ${r.status}${r.status === 'available' && availableQuantity(r, ctx.now) === 0 ? ', none in date' : ''}`).join('; ')}).` : `No onboard resource provides '${t.tag}'.`)
    }
  }
  if (s.requiredQualification) {
    const q = crewWith(ctx.mission, s.requiredQualification)
    if (!q.length) issues.push(`No crew member is recorded with the qualification '${s.requiredQualification}'.`)
    else if (q.length === 1 && q[0] === ctx.encounter.subjectId) issues.push('The only crew member with this qualification is the patient.')
  }
  if (s.parameterIds?.length) {
    const linked = new Set(ctx.encounter.observationIds)
    const have = new Set(ctx.ws.observations.filter(o => linked.has(o.id) && numericValue(o) !== null).map(o => o.parameterId))
    const missing = s.parameterIds.filter(id => !have.has(id))
    if (missing.length) notes.push(`Not yet linked to this encounter: ${missing.join(', ')}.`)
  }
  if (s.kind === 'escalate' || s.kind === 'decide') {
    const rt = roundTripMinutes(ctx.mission)
    notes.push(rt === null ? 'No ground link: decisions are made onboard.' : rt === 0 ? 'Real-time ground link available.' : `Ground round trip at least ${Math.round(rt)} min.`)
  }
  return { ok: issues.length === 0, issues, notes }
}

export function advanceProtocol(run: ProtocolRun, p: ProtocolDefinition, input: { at: string; byRole: ActorRole; status: 'done' | 'skipped'; optionId?: string; note?: string; observationIds: string[]; safetyIssues: string[] }): ProtocolRun {
  if (run.status !== 'active' || !run.currentStepId) throw new Error('This protocol run is not active.')
  if (input.byRole !== 'medical') throw new Error('Protocol steps are recorded in the Crew Medical Officer context.')
  const s = p.steps.find(x => x.id === run.currentStepId)
  if (!s) throw new Error('Unknown step.')
  if (input.status === 'skipped' && !input.note?.trim()) throw new Error('Give a reason for skipping a step.')
  if (input.safetyIssues.length && !input.note?.trim()) throw new Error('Acknowledge the safety issues in a note before continuing.')
  let next: string | null
  if (s.options?.length && input.status === 'done') {
    const o = s.options.find(x => x.id === input.optionId)
    if (!o) throw new Error('Choose one of the options for this step.')
    next = o.nextStepId
  } else next = s.nextStepId ?? null
  const rec = { stepId: s.id, status: input.status, at: input.at, byRole: input.byRole, ...(input.optionId ? { optionId: input.optionId } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}), observationIds: input.observationIds, safetyIssues: input.safetyIssues }
  return { ...run, steps: [...run.steps, rec], currentStepId: next, status: next ? 'active' : 'completed' }
}

export function recordDecision(e: CareEncounter, input: Omit<DecisionRecord, 'encounterId'>): DecisionRecord {
  if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
  if (input.byRole === 'system') throw new Error('Decisions are made by people.')
  if (input.recommendation.source !== 'attention_item' && input.byRole !== 'medical') throw new Error('Clinical decisions are recorded in the Crew Medical Officer context.')
  if (input.decision !== 'accepted' && !input.rationale.trim()) throw new Error('Explain why the suggestion was declined or modified.')
  return { ...input, encounterId: e.id, rationale: input.rationale.trim() }
}

export function setPriority(e: CareEncounter, priority: EncounterPriority, byRole: ActorRole): CareEncounter {
  if (e.status === 'closed') throw new Error('Closed encounters are read-only.')
  if (byRole === 'system') throw new Error('Priority is set by people.')
  if (byRole === 'astronaut' && priority !== 'emergency' && (e.priority ?? 'routine') === 'emergency') throw new Error('Only the CMO can downgrade an emergency.')
  return { ...e, priority }
}

/** Single-screen summary of an encounter for handover or for the ground. */
export function encounterSummary(e: CareEncounter, ws: HealthWorkspace, nameOf: (pid: string) => string): string {
  const intake = ws.intakes.filter(i => i.encounterId === e.id)
  const findings = ws.findings.filter(f => f.encounterId === e.id)
  const obs = ws.observations.filter(o => e.observationIds.includes(o.id))
  const ints = ws.interventions.filter(i => i.encounterId === e.id)
  const lines = [
    `Concern: ${e.concern} [${e.priority ?? 'routine'}; ${e.status}]`,
    ...intake.flatMap(i => i.symptoms.map(s => `Symptom: ${s.label}${s.severity !== undefined ? ` (${s.severity}/10 self-rated)` : ''}${s.onsetAt ? `, since ${s.onsetAt.slice(0, 16)}` : ''}`)),
    ...findings.map(f => `Exam (${f.area}): ${f.finding}`),
    ...obs.map(o => `${nameOf(o.parameterId)}: ${numericValue(o) ?? 'missing'} at ${o.effectiveAt.slice(0, 16)}`),
    ...ints.map(i => `Action (${i.kind}): ${i.description}${i.outcome ? ` → ${i.outcome.result}` : ''}`),
  ]
  return lines.join('\n')
}
