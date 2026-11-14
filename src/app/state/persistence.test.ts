import { beforeEach, describe, expect, it } from 'vitest'
import { appReducer, createAppState } from './reducer'
import { LEGACY_STORAGE_KEY, persistState, restoreState, STORAGE_KEY } from './persistence'

beforeEach(() => localStorage.clear())
describe('validated persistence', () => {
  it('round-trips progress and acknowledgements but restores a safe personal context', () => {
    let state = appReducer(createAppState(), { type: 'mode/set', mode: 'mission' })
    state = appReducer(state, { type: 'mission/scenario', scenario: 'sleep-disruption', seed: 42 })
    state = appReducer(state, { type: 'mission/advance', seconds: 180 })
    state = appReducer(state, { type: 'alerts/acknowledge', id: state.mission.alerts[0]!.id })
    persistState(localStorage, state)
    const result = restoreState(localStorage)
    expect(result.error).toBeNull(); expect(result.state?.mission.alerts[0]?.status).toBe('acknowledged')
    expect(result.state?.mission.missionTime).toBe(state.mission.missionTime)
    expect(result.state?.mode).toBe('astronaut'); expect(result.state?.mission.paused).toBe(true)
  })
  it('preserves corrupt and incompatible bytes for explicit recovery', () => {
    for (const raw of ['broken json', JSON.stringify({ version: 99, state: createAppState() })]) {
      localStorage.setItem(STORAGE_KEY, raw)
      expect(restoreState(localStorage).error).not.toBeNull()
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
    }
  })
  it('rejects foreign provenance and malformed nested records', () => {
    const state = createAppState()
    state.personal.measurements = [{ ...state.mission.measurements[0]! }]
    expect(() => persistState(localStorage, state)).toThrow()
    const fresh = createAppState()
    const raw = JSON.parse(JSON.stringify({ version: 2, state: fresh }))
    raw.state.mission.measurements[0].value = 'invalid'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw))
    expect(restoreState(localStorage).error).not.toBeNull()
  })
  it('propagates quota errors without removing the old stored state', () => {
    expect(() => persistState({ setItem: () => { throw new DOMException('Quota full', 'QuotaExceededError') } }, createAppState())).toThrow()
  })
  it('migrates Core v2 personal measurements once and leaves the v2 copy untouched', () => {
    const v2 = createAppState() as unknown as Record<string, unknown>
    delete v2.health
    ;(v2.personal as { measurements: unknown[] }).measurements = [{ id: 'old-1', astronautId: 'crew-01', metric: 'sleep_duration', value: 6.5, unit: 'h', timestamp: '2026-11-14T10:00:00.000Z', source: 'manual', origin: 'observed', quality: 'valid' }]
    const raw = JSON.stringify({ version: 2, state: v2 })
    localStorage.setItem(LEGACY_STORAGE_KEY, raw)
    const result = restoreState(localStorage)
    expect(result.error).toBeNull()
    expect(result.state?.health.observations[0]).toMatchObject({ id: 'old-1', parameterId: 'sleep_duration', value: { type: 'quantity', value: 6.5, unitId: 'h' } })
    expect(result.state?.notice).toContain('migrated')
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(raw)
    persistState(localStorage, result.state!)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(3)
  })
  it('rejects a stored v3 workspace whose observations break registry rules', () => {
    const state = createAppState()
    state.health = { ...state.health, observations: [{ id: 'x', subjectId: 'crew-01', parameterId: 'spo2', parameterVersion: 1, value: { type: 'quantity', value: 140, unitId: 'percent' }, effectiveAt: '2026-11-15T08:00:00.000Z', recordedAt: '2026-11-15T08:00:00.000Z', sourceId: 'manual-entry', method: 'manual', origin: 'observed', quality: 'valid', demonstrationOnly: false }] }
    expect(() => persistState(localStorage, state)).toThrow()
  })
})
