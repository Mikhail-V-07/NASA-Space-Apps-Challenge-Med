import { describe, expect, it } from 'vitest'
import type { HealthWorkspace, Observation } from '../../contracts/types'
import {
  ASSISTANT_PROVIDERS, DEMO_RULES, MISSION_PRESETS, PROTOCOLS, adherence, alignDaily, applyHealthCommand, availableQuantity, completeness,
  computeBaseline, createObservation, demonstrationInventory, emptyWorkspace, evaluateRules, forecast, guardrail, localKnowledgeProvider,
  occurrenceStatus, parseWorkspace, protocolProblems, registry, resolveWindow, ruleProblems, runAnalyses, safetyCheck, searchKnowledge,
  series, trend, useResource, visibleTo, withCrewQualifications, composeGroundMessage, messageState, KNOWLEDGE, SOURCE_REFERENCES,
} from './index'
import type { CommandContext, HealthCommand } from './index'
import { simulate } from '../simulation/v3'

const T0 = '2026-11-01T00:00:00.000Z'
const day = (d: number, h = 7) => new Date(Date.parse(T0) + d * 86_400_000 + h * 3_600_000).toISOString()
let n = 0
const ctx = (role: 'astronaut' | 'medical' | 'system', subjectId: string | null = role === 'astronaut' ? 'crew-01' : null, at = day(20)): CommandContext => ({ actor: { role, subjectId }, at, newId: () => `id-${++n}`, registry, mission: MISSION_PRESETS[2]! })
const obs = (pid: string, v: number | null, at: string, subject = 'crew-01'): Observation => createObservation({ id: `o-${++n}`, subjectId: subject, parameterId: pid, value: v, effectiveAt: at, recordedAt: at, sourceId: 'manual-entry', method: 'manual', origin: 'observed' }, registry)
const run = (ws: HealthWorkspace, cmds: HealthCommand[], c: CommandContext) => cmds.reduce((w, cmd) => applyHealthCommand(w, cmd, c), ws)

describe('versioned baselines', () => {
  const recs = Array.from({ length: 14 }, (_, i) => obs('resting_hr', 60 + (i % 3), day(i)))
  it('requires the policy minimum, not just three readings', () => {
    expect(() => computeBaseline(recs.slice(0, 5), { method: 'median', minReadings: 7, dataset: { type: 'last_n', n: 14 } }, { id: 'b', at: day(15), byRole: 'medical', existing: [] })).toThrow()
  })
  it('records policy, version and supersedes link; acceptance supersedes the old version', () => {
    let ws = { ...emptyWorkspace(), observations: recs }
    ws = run(ws, [{ type: 'baseline/compute', subjectId: 'crew-01', parameterId: 'resting_hr', policy: { method: 'median', minReadings: 7, dataset: { type: 'last_n', n: 7 } } }], ctx('medical'))
    const b1 = ws.baselines[0]!
    ws = run(ws, [{ type: 'baseline/accept', baselineId: b1.id }, { type: 'baseline/compute', subjectId: 'crew-01', parameterId: 'resting_hr', policy: { method: 'mean', minReadings: 10, dataset: { type: 'last_n', n: 14 } } }], ctx('medical'))
    const b2 = ws.baselines[1]!
    expect(b1.version).toBe(1); expect(b2.version).toBe(2); expect(b2.supersedesId).toBe(b1.id); expect(b2.method).toBe('descriptive_mean'); expect(b2.policy?.minReadings).toBe(10)
    ws = run(ws, [{ type: 'baseline/accept', baselineId: b2.id }], ctx('medical'))
    expect(ws.baselines[0]!.status).toBe('superseded')
  })
  it('rejects a policy below the arithmetic floor', () => {
    expect(() => computeBaseline(recs, { method: 'median', minReadings: 2, dataset: { type: 'last_n', n: 14 } }, { id: 'b', at: day(15), byRole: 'medical', existing: [] })).toThrow()
  })
})

describe('analytics', () => {
  const rising = Array.from({ length: 10 }, (_, i) => obs('body_mass', 70 - i * 0.2, day(i)))
  it('computes a trend with an uncertainty interval', () => {
    const t = trend(rising)!
    expect(t.direction).toBe('decreasing')
    expect(Math.abs(t.slopePerDay + 0.2) < 1e-6).toBe(true)
    expect(t.interval).toBeDefined()
  })
  it('marks a noisy short series as uncertain', () => {
    const t = trend([obs('body_mass', 70, day(0)), obs('body_mass', 72, day(1)), obs('body_mass', 69, day(2))])!
    expect(t.direction).toBe('uncertain')
  })
  it('measures completeness against a cadence and is null without one', () => {
    const w = { from: day(0, 0), to: day(10, 0) }
    const k = completeness(rising, w, 24)!
    expect(k.expected).toBe(10); expect(k.covered).toBe(10)
    expect(completeness(rising, w, null)).toBeNull()
  })
  it('resolves windows and runs the extensible analyses', () => {
    const w = resolveWindow({ preset: '7d' }, day(10, 0))
    expect(w.from).toBe(day(3, 0))
    const results = runAnalyses(rising, registry.parameter('body_mass')!, { window: resolveWindow({ preset: 'all' }, day(10), day(0)), now: day(10), expectedEveryHours: 24 })
    expect(results.map(r => r.id)).toContain('trend')
    expect(results.map(r => r.id)).toContain('completeness')
  })
  it('aligns multiple parameters by day', () => {
    const rows = alignDaily({ body_mass: rising, sleep_duration: [obs('sleep_duration', 7, day(1))] })
    expect(rows[1]!.values.sleep_duration).toBe(7)
    expect(rows[0]!.values.sleep_duration).toBeNull()
  })
  it('converts kJ to kcal exactly', () => {
    const o = createObservation({ id: 'e1', subjectId: 'crew-01', parameterId: 'energy_intake', value: 4.184, unitId: 'kJ', effectiveAt: day(1), recordedAt: day(1), sourceId: 'manual-entry', method: 'manual', origin: 'observed' }, registry)
    expect(o.value?.type === 'quantity' && Math.abs(o.value.value - 1) < 1e-12).toBe(true)
  })
})

describe('prevention', () => {
  it('derives adherence from completions and linked observations', () => {
    let ws = emptyWorkspace()
    ws = run(ws, [{ type: 'plan/create', subjectId: 'crew-01', domain: 'measurement', title: 'Resting HR', instructions: '', parameterIds: ['resting_hr'], everyHours: 24, startAt: day(0, 0), endAt: null, source: 'cmo' }], ctx('medical', null, day(0, 0)))
    const plan = ws.plans[0]!
    ws = { ...ws, observations: [obs('resting_hr', 60, day(0)), obs('resting_hr', 61, day(1))] }
    ws = run(ws, [{ type: 'plan/complete', planItemId: plan.id, dueAt: day(2, 0), status: 'skipped', observationIds: [], note: 'EVA day' }], ctx('astronaut', 'crew-01', day(2, 12)))
    const occ = occurrenceStatus(plan, ws.completions, ws.observations, day(0, 0), day(4, 12))
    expect(occ.map(o => o.status).slice(0, 5)).toEqual(['evidenced', 'evidenced', 'skipped', 'missed', 'open'])
    const a = adherence(occ)
    expect(a.due).toBe(4); expect(a.done).toBe(2)
  })
  it('keeps plan definition with the CMO', () => {
    expect(() => run(emptyWorkspace(), [{ type: 'plan/create', subjectId: 'crew-01', domain: 'sleep', title: 'x', instructions: '', parameterIds: [], everyHours: 24, startAt: T0, endAt: null, source: 'cmo' }], ctx('astronaut'))).toThrow()
  })
})

describe('rules → attention items', () => {
  it('re-expresses DEMO-RECOVERY-01 as a combination and labels it demonstration', () => {
    const ws = { ...emptyWorkspace(), observations: [obs('sleep_duration', 5, day(1)), obs('sleep_duration', 5.5, day(2)), obs('sleep_duration', 5.2, day(3)), obs('fatigue', 8, day(3, 8))] }
    const items = evaluateRules(DEMO_RULES, ws, ['crew-01'], 'observed', day(4), registry)
    const item = items.find(i => i.ruleId === 'DEMO-RECOVERY-01')!
    expect(item.ruleStatus).toBe('demonstration')
    expect(item.evidenceObservationIds).toHaveLength(4)
    expect(item.limitations.some(l => l.includes('DEMONSTRATION'))).toBe(true)
  })
  it('does not allow a fixed cutoff to be marked approved', () => {
    const r = { ...DEMO_RULES.find(x => x.id === 'DEMO-SLEEP-LOW')!, status: 'approved' as const }
    expect(ruleProblems(r, DEMO_RULES, registry).length).toBeGreaterThan(0)
  })
  it('only flags stale data when a plan expects it', () => {
    const base = { ...emptyWorkspace(), observations: [obs('resting_hr', 60, day(0))] }
    expect(evaluateRules(DEMO_RULES, base, ['crew-01'], 'observed', day(5), registry).some(i => i.ruleId === 'DQ-STALE-RHR')).toBe(false)
    const planned = run(base, [{ type: 'plan/create', subjectId: 'crew-01', domain: 'measurement', title: 'RHR', instructions: '', parameterIds: ['resting_hr'], everyHours: 24, startAt: T0, endAt: null, source: 'cmo' }], ctx('medical'))
    expect(evaluateRules(DEMO_RULES, planned, ['crew-01'], 'observed', day(5), registry).some(i => i.ruleId === 'DQ-STALE-RHR')).toBe(true)
  })
})

describe('clinical framework', () => {
  const setup = () => {
    let ws = { ...emptyWorkspace(), resources: demonstrationInventory(T0) }
    ws = run(ws, [{ type: 'encounter/open', subjectId: 'crew-01', concern: 'Headache since morning', trigger: { type: 'self_report', refIds: [] }, observationIds: [] }], ctx('astronaut'))
    return ws
  }
  it('records intake (crew) and findings (CMO only)', () => {
    let ws = setup(); const e = ws.encounters[0]!
    ws = run(ws, [{ type: 'intake/record', encounterId: e.id, symptoms: [{ label: 'Headache', severity: 4 }], history: 'Started after sleep period' }], ctx('astronaut'))
    expect(ws.intakes[0]!.symptoms[0]!.label).toBe('Headache')
    expect(() => run(ws, [{ type: 'finding/record', encounterId: e.id, area: 'Head', finding: 'x' }], ctx('astronaut'))).toThrow()
    ws = run(ws, [{ type: 'finding/record', encounterId: e.id, area: 'Head and neck', finding: 'Recorded observation text' }], ctx('medical'))
    expect(ws.findings).toHaveLength(1)
  })
  it('protocols are illustrative and consistent, and cannot claim approval', () => {
    for (const p of PROTOCOLS) { expect(p.status).toBe('illustrative'); expect(protocolProblems(p, new Set())).toEqual([]) }
    expect(protocolProblems({ ...PROTOCOLS[0]!, status: 'approved' }, new Set()).length).toBeGreaterThan(0)
  })
  it('runs a protocol with safety checks that surface equipment, qualification and comms issues', () => {
    let ws = setup(); const e = ws.encounters[0]!
    ws = run(ws, [{ type: 'protocol/start', encounterId: e.id, protocolId: 'ILL-EMERG' }], ctx('medical'))
    expect(ws.encounters[0]!.priority).toBe('emergency')
    const p = PROTOCOLS.find(x => x.id === 'ILL-EMERG')!
    const mission = withCrewQualifications(MISSION_PRESETS[2]!, [{ id: 'crew-01', qualifications: ['basic_life_support'] }])
    const check = safetyCheck(p, p.steps.find(s => s.id === 'procedures')!, { resources: ws.resources, mission, now: day(20), ws, encounter: ws.encounters[0]! })
    expect(check.ok).toBe(false)
    expect(check.issues.some(i => i.includes('ecg'))).toBe(true)
    expect(check.issues.some(i => i.includes('patient'))).toBe(true)
    const r = ws.protocolRuns[0]!
    ws = run(ws, [{ type: 'protocol/advance', runId: r.id, status: 'done', observationIds: [], safetyIssues: [] }], ctx('medical'))
    expect(() => run(ws, [{ type: 'protocol/advance', runId: r.id, status: 'done', observationIds: [], safetyIssues: check.issues }], ctx('medical'))).toThrow()
    ws = run(ws, [{ type: 'protocol/advance', runId: r.id, status: 'done', observationIds: [], safetyIssues: check.issues, note: 'ECG under maintenance; proceeding per crew lead' }], ctx('medical'))
    expect(ws.protocolRuns[0]!.currentStepId).toBe('record')
  })
  it('records human decisions on suggestions with rationale', () => {
    let ws = setup(); const e = ws.encounters[0]!
    expect(() => run(ws, [{ type: 'decision/record', encounterId: e.id, recommendation: { source: 'protocol_step', refId: 'ILL-GEN-ASSESS:consult', text: 'Send summary', evidenceIds: [], limitations: [] }, decision: 'declined', rationale: '' }], ctx('medical'))).toThrow()
    ws = run(ws, [{ type: 'decision/record', encounterId: e.id, recommendation: { source: 'protocol_step', refId: 'ILL-GEN-ASSESS:consult', text: 'Send summary', evidenceIds: [], limitations: [] }, decision: 'modified', rationale: 'Will send at the next comms window' }], ctx('medical'))
    expect(ws.decisions[0]!.decision).toBe('modified')
  })
  it('queues ground messages with the mission delay', () => {
    const m = composeGroundMessage(MISSION_PRESETS[2]!, { id: 'm', subjectId: 'crew-01', at: day(1), byRole: 'medical', summary: 'Summary', recordIds: [] })
    expect(messageState(m, day(1))).toBe('in_transit')
    expect(messageState(m, new Date(Date.parse(day(1)) + 21 * 60_000).toISOString())).toBe('delivered')
  })
})

describe('resources', () => {
  it('excludes expired lots, uses first-expiring stock first and forecasts expiry within the mission', () => {
    const inv = demonstrationInventory(T0), an = inv.find(r => r.id === 'res-analgesic')!
    expect(availableQuantity(an, day(1))).toBe(40)
    const el = inv.find(r => r.id === 'res-electrodes')!
    const { resource, uses } = useResource(el, { quantity: 8, at: day(1), byRole: 'medical', subjectId: 'crew-01', newId: () => `u${++n}` })
    expect(uses.map(u => [u.lotId, u.quantity])).toEqual([['EL-A', 6], ['EL-B', 2]])
    expect(forecast(el, day(1), day(790)).status).toBe('expires_in_mission')
    expect(forecast(resource, day(1), day(790)).status).toBe('ok')
    expect(() => useResource(el, { quantity: 1, at: day(1), byRole: 'astronaut', subjectId: 'crew-01', newId: () => 'x' })).toThrow()
  })
})

describe('knowledge and assistant', () => {
  it('every knowledge point cites a known source', () => {
    const ids = new Set(SOURCE_REFERENCES.map(s => s.id))
    for (const a of KNOWLEDGE) for (const p of a.points) { expect(p.sourceRefIds.length).toBeGreaterThan(0); for (const s of p.sourceRefIds) expect(ids.has(s)).toBe(true) }
    expect(searchKnowledge('bone loss')[0]!.id).toBe('kb-bone')
  })
  it('refuses diagnosis, dosing and normality questions', () => {
    expect(guardrail('Do I have a kidney stone?')).toBeTruthy()
    expect(guardrail('What dose should I take?')).toBeTruthy()
    expect(guardrail('Is my heart rate normal?')).toBeTruthy()
    const a = localKnowledgeProvider.answer('tell me about sleep', { attention: [], parameterName: x => x })
    expect(a.refused).toBe(false); expect(a.citations.length).toBeGreaterThan(0)
  })
  it('the LLM provider is explicitly not connected', () => {
    const llm = ASSISTANT_PROVIDERS.find(p => p.id === 'llm')!
    expect(llm.status).toBe('not_connected')
    expect(llm.answer('hello', { attention: [], parameterName: x => x }).refused).toBe(true)
  })
})

describe('v3 simulator', () => {
  const cfg = { scenario: 'sleep_disruption' as const, seed: 7, crewIds: ['crew-01', 'crew-02', 'crew-03'], startAt: T0, days: 21 }
  it('is reproducible and synthetic-only', () => {
    const a = simulate(cfg), b = simulate(cfg)
    expect(a.workspace.observations.length).toBe(b.workspace.observations.length)
    expect(JSON.stringify(a.workspace.observations.slice(0, 20))).toBe(JSON.stringify(b.workspace.observations.slice(0, 20)))
    expect(a.workspace.observations.every(o => o.origin === 'synthetic' && o.demonstrationOnly && o.sourceId === 'mission-simulator')).toBe(true)
    expect(simulate({ ...cfg, seed: 8 }).workspace.observations[0]!.id).not.toBe(undefined)
  })
  it('feeds the rules engine: the affected crew member gets deviation items', () => {
    const { workspace, now } = simulate(cfg)
    const items = evaluateRules(DEMO_RULES, workspace, cfg.crewIds, 'synthetic', now, registry)
    expect(items.some(i => i.subjectId === 'crew-01' && i.ruleId === 'DEV-SLEEP-DOWN')).toBe(true)
    expect(items.some(i => i.subjectId === 'crew-02' && i.ruleId === 'DEV-SLEEP-DOWN')).toBe(false)
  })
  it('round-trips through the workspace schema and accepts synthetic commands', () => {
    const { workspace, now } = simulate({ ...cfg, scenario: 'hydration_shortfall' })
    const parsed = parseWorkspace(JSON.parse(JSON.stringify(workspace)), registry)
    expect(parsed.plans.length).toBe(15)
    const c = { ...ctx('astronaut', 'crew-01', now), origin: 'synthetic' as const }
    const next = applyHealthCommand(parsed, { type: 'encounter/open', subjectId: 'crew-01', concern: 'Synthetic concern', trigger: { type: 'attention_item', refIds: ['x'] }, observationIds: [] }, c)
    expect(next.encounters[0]!.demonstrationOnly).toBe(true)
    expect(series(next.observations, { subjectId: 'crew-01', parameterId: 'fluid_intake', origin: 'synthetic' }).length).toBeGreaterThan(20)
  })
})

describe('workspace back-compat and scoping', () => {
  it('restores an older v3 workspace without the new collections', () => {
    const old = { schemaVersion: 3, observations: [], baselines: [], encounters: [], interventions: [], audit: [] }
    expect(parseWorkspace(old, registry).plans).toEqual([])
  })
  it('astronauts see only their own plans, intakes and attention states', () => {
    let ws = emptyWorkspace()
    ws = run(ws, [{ type: 'plan/create', subjectId: 'crew-02', domain: 'sleep', title: 'Sleep', instructions: '', parameterIds: ['sleep_duration'], everyHours: 24, startAt: T0, endAt: null, source: 'cmo' }], ctx('medical'))
    ws = run(ws, [{ type: 'attention/set', itemId: 'R:crew-02:observed:x', subjectId: 'crew-02', status: 'acknowledged' }], ctx('medical'))
    const v = visibleTo(ws, { role: 'astronaut', subjectId: 'crew-01' })
    expect(v.plans).toHaveLength(0); expect(v.attention).toHaveLength(0); expect(v.audit).toHaveLength(0)
  })
  it('only the CMO dismisses attention items, with a reason', () => {
    expect(() => run(emptyWorkspace(), [{ type: 'attention/set', itemId: 'R:crew-01:observed:x', subjectId: 'crew-01', status: 'dismissed', note: 'x' }], ctx('astronaut'))).toThrow()
    expect(() => run(emptyWorkspace(), [{ type: 'attention/set', itemId: 'R:crew-01:observed:x', subjectId: 'crew-01', status: 'dismissed' }], ctx('medical'))).toThrow()
  })
})
