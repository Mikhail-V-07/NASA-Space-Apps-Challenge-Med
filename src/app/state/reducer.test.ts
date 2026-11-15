import { describe, expect, it } from 'vitest'
import type { ClinicalAction, HealthMeasurement } from '../../../contracts/types'
import { appReducer, createAppState, selectWorkspace } from './reducer'

const observed = (id = 'own', astronautId = 'crew-01'): HealthMeasurement => ({ id, astronautId, metric: 'sleep_duration', value: 7, unit: 'h', timestamp: '2026-11-14T10:00:00.000Z', source: 'manual', origin: 'observed', quality: 'valid' })
function disrupted() {
  let state = appReducer(createAppState(), { type: 'mode/set', mode: 'mission' })
  state = appReducer(state, { type: 'mission/scenario', scenario: 'sleep-disruption', seed: 42 })
  return appReducer(state, { type: 'mission/advance', seconds: 180 })
}
describe('core store and user contexts', () => {
  it('starts in personal observed health with no fabricated measurements', () => {
    const state = createAppState(), workspace = selectWorkspace(state)
    expect(state.section).toBe('health'); expect(state.scope).toBe('observed')
    expect(workspace.measurements).toHaveLength(0); expect(workspace.crew).toHaveLength(1)
  })
  it('rejects selecting or writing another astronaut in ordinary astronaut mode', () => {
    const state = createAppState()
    expect(appReducer(state, { type: 'crew/select', id: 'crew-02' })).toBe(state)
    const rejected = appReducer(state, { type: 'measurements/upsert', records: [observed('foreign', 'crew-02')] })
    expect(rejected.personal.measurements).toHaveLength(0); expect(rejected.notice).toContain('Not saved')
  })
  it('redacts other records after returning from medical review', () => {
    let state = appReducer(createAppState(), { type: 'mode/set', mode: 'medical' })
    state = appReducer(state, { type: 'measurements/upsert', records: [observed(), observed('other', 'crew-02')] })
    state = appReducer(state, { type: 'mode/set', mode: 'astronaut' })
    expect(state.selectedAstronautId).toBe('crew-01')
    expect(selectWorkspace(state).measurements.map(r => r.id)).toEqual(['own'])
    expect(selectWorkspace(state).crew.map(r => r.id)).toEqual(['crew-01'])
  })
  it('upserts without mutation and preserves observed records across scenario resets', () => {
    const initial = createAppState()
    let state = appReducer(initial, { type: 'measurements/upsert', records: [observed(), observed()] })
    expect(state.personal.measurements).toHaveLength(1); expect(initial.personal.measurements).toHaveLength(0)
    state = appReducer(state, { type: 'mode/set', mode: 'mission' })
    state = appReducer(state, { type: 'mission/scenario', scenario: 'co2-excursion', seed: 12 })
    expect(state.personal.measurements).toHaveLength(1)
    expect(state.personal.measurements[0]).toMatchObject(observed())
    expect(state.health.observations.map(o => o.id)).toEqual(['own'])
    expect(state.mission.measurements.every(r => r.origin === 'synthetic')).toBe(true)
  })
  it('does not allow observation origins to cross workspace boundaries', () => {
    const state = appReducer(createAppState(), { type: 'measurements/upsert', records: [{ ...observed(), origin: 'synthetic' }] })
    expect(state.personal.measurements).toHaveLength(0)
  })
  it('derives an observed baseline only from three same-unit own readings', () => {
    let state = createAppState()
    state = appReducer(state, { type: 'measurements/upsert', records: [observed('one'), { ...observed('two'), value: 8 }] })
    expect(selectWorkspace(state).crew[0]?.baselines.sleep_duration).toBeUndefined()
    state = appReducer(state, { type: 'measurements/upsert', records: [{ ...observed('three'), value: 9 }] })
    expect(selectWorkspace(state).crew[0]?.baselines.sleep_duration).toBe(8)
  })
  it('detects, acknowledges, follows up and resolves through distinct transitions', () => {
    let state = disrupted()
    const alert = state.mission.alerts[0]!, encounter = state.mission.encounters[0]!
    expect(alert.title).toBe('Recovery indicators changed'); expect(encounter.status).toBe('open')
    state = appReducer(state, { type: 'alerts/acknowledge', id: alert.id })
    expect(state.mission.encounters[0]?.status).toBe('open')
    state = appReducer(state, { type: 'mission/advance', seconds: 60 })
    expect(state.mission.alerts[0]?.status).toBe('acknowledged')
    expect(state.mission.encounters).toHaveLength(1)
    state = appReducer(state, { type: 'encounter/transition', id: encounter.id, transition: 'review', at: state.mission.missionTime })
    const action: ClinicalAction = { id: 'follow', astronautId: encounter.astronautId, timestamp: state.mission.missionTime, source: 'manual', origin: 'synthetic', quality: 'valid', unit: 'action', sourceRefIds: [], demonstrationOnly: true, kind: 'follow_up', note: 'Repeated the check', observationIds: [], completed: true }
    state = appReducer(state, { type: 'encounter/follow-up', id: encounter.id, action })
    expect(state.mission.encounters[0]?.status).toBe('under_review')
    state = appReducer(state, { type: 'mode/set', mode: 'medical' }); state = appReducer(state, { type: 'scope/set', scope: 'synthetic' })
    state = appReducer(state, { type: 'encounter/transition', id: encounter.id, transition: 'resolve', at: state.mission.missionTime })
    expect(state.mission.encounters[0]?.status).toBe('resolved')
  })
  it('prevents mission controls from being used in the personal context', () => {
    const state = createAppState()
    expect(appReducer(state, { type: 'navigate', section: 'simulation' })).toBe(state)
    expect(appReducer(state, { type: 'mission/advance', seconds: 180 })).toBe(state)
  })
  it('routes v3 commands through role checks and keeps the v2 projection in sync', () => {
    let state = createAppState()
    const record = { id: 'hr-1', subjectId: 'crew-01', parameterId: 'hr', parameterVersion: 1, value: { type: 'quantity' as const, value: 61, unitId: 'bpm' }, effectiveAt: '2026-11-15T08:00:00.000Z', recordedAt: '2026-11-15T08:00:00.000Z', sourceId: 'manual-entry', method: 'manual' as const, origin: 'observed' as const, quality: 'valid' as const, demonstrationOnly: false }
    state = appReducer(state, { type: 'health/command', command: { type: 'observation/record', record } })
    expect(state.health.observations).toHaveLength(1)
    expect(state.personal.measurements[0]).toMatchObject({ id: 'hr-1', metric: 'heart_rate', value: 61 })
    const spo2 = { ...record, id: 'spo2-1', parameterId: 'spo2', value: { type: 'quantity' as const, value: 97, unitId: 'percent' } }
    state = appReducer(state, { type: 'health/command', command: { type: 'observation/record', record: spo2 } })
    expect(state.health.observations).toHaveLength(2); expect(state.personal.measurements).toHaveLength(1)
    state = appReducer(state, { type: 'health/command', command: { type: 'encounter/open', subjectId: 'crew-01', concern: 'Headache since waking', trigger: { type: 'self_report', refIds: [] }, observationIds: [] } })
    const blocked = appReducer(state, { type: 'health/command', command: { type: 'encounter/close', encounterId: state.health.encounters[0]!.id, closure: 'x' } })
    expect(blocked.notice).toContain('Crew Medical Officer'); expect(blocked.health.encounters[0]?.status).toBe('open')
    const preview = appReducer(appReducer(state, { type: 'scope/set', scope: 'synthetic' }), { type: 'health/command', command: { type: 'observation/record', record: { ...record, id: 'hr-2' } } })
    // v3.1: the Simulated scope has its own synthetic workspace; observed records cannot be written into it.
    expect(preview.health.observations).toHaveLength(2); expect(preview.notice).toContain('synthetic records only')
    expect(preview.simulation.observations.some(o => o.id === 'hr-2')).toBe(false)
  })

  it('v3.1: simulated workspace accepts synthetic workflow commands; rules and mission config are CMO-only', () => {
    let state = appReducer(createAppState(), { type: 'scope/set', scope: 'synthetic' })
    const before = state.simulation.encounters.length
    state = appReducer(state, { type: 'health/command', command: { type: 'encounter/open', subjectId: 'crew-01', concern: 'Synthetic review', trigger: { type: 'attention_item', refIds: [] }, observationIds: [] } })
    expect(state.simulation.encounters.length).toBe(before + 1); expect(state.health.encounters).toHaveLength(0)
    expect(state.simulation.encounters.at(-1)!.openedAt).toBe(state.sim.now)
    const rule = state.rules.find(r => r.id === 'DEV-RHR-UP')!
    expect(appReducer(state, { type: 'rules/update', rule: { ...rule, status: 'disabled' } }).rules.find(r => r.id === rule.id)!.status).toBe('demonstration')
    const medical = appReducer(state, { type: 'mode/set', mode: 'medical' })
    expect(appReducer(medical, { type: 'rules/update', rule: { ...rule, status: 'approved' } }).notice).toContain('cannot mark a rule approved')
    const updated = appReducer(medical, { type: 'rules/update', rule: { ...rule, status: 'disabled' } })
    expect(updated.rules.find(r => r.id === rule.id)).toMatchObject({ status: 'disabled', version: 2 })
    const sim = appReducer(state, { type: 'sim/generate', scenario: 'nominal', seed: 3, days: 10 })
    expect(sim.sim).toMatchObject({ scenario: 'nominal', seed: 3, days: 10 }); expect(sim.health).toBe(state.health)
  })
})
