import type { AnalysisRule, AssessmentResult, ClinicalAction, ClinicalWorkspace, CrewQualification, HealthAlert, HealthMeasurement, HealthWorkspace, MetricKey, MissionProfile, MissionSnapshot, MissionState, ScenarioId } from '../../../contracts/types'
import { initialState, runScenario, step } from '../../simulation/engine'
import { synchronizeClinical } from '../../health/engine'
import { addFollowUp, transitionEncounter } from '../../health/clinical'
import { actionSchema, assessmentSchema, validateMeasurement } from '../../shared/validation'
import { DEMO_RULES, MISSION_PRESETS, applyHealthCommand, emptyWorkspace, fromLegacy, legacyProjection, registry, ruleProblems } from '../../domain'
import { simulate } from '../../simulation/v3'
import type { V3ScenarioId } from '../../simulation/v3'
import type { Actor, HealthCommand } from '../../domain'

export type Section = 'dashboard' | 'health' | 'spacecraft' | 'simulation' | 'events' | 'assessments' | 'research'
export type UserMode = 'astronaut' | 'medical' | 'mission'
export type DataScope = 'observed' | 'synthetic'
export interface AppState {
  mission: MissionSnapshot
  personal: ClinicalWorkspace
  /** v3 observed health records — the single writable source. `personal.measurements` is derived from it. */
  health: HealthWorkspace
  /** v3.1 synthetic health workspace produced by the v3 simulator. Writable only in Simulated scope. */
  simulation: HealthWorkspace
  sim: SimulationState
  /** Mission configuration (preset + crew qualifications + start). */
  missionConfig: MissionConfig
  /** Configurable analysis rules (all shipped rules are 'demonstration'). */
  rules: AnalysisRule[]
  section: Section
  mode: UserMode
  scope: DataScope
  sessionAstronautId: string
  selectedAstronautId: string | null
  selectedCompartmentId: string | null
  notice: string | null
}
export interface SimulationState { scenario: V3ScenarioId; seed: number; days: number; startAt: string; now: string }
export interface MissionConfig { profileId: string; startAt: string; qualifications: CrewQualification[] }
export type AppAction =
  | { type: 'navigate'; section: Section }
  | { type: 'mode/set'; mode: UserMode }
  | { type: 'scope/set'; scope: DataScope }
  | { type: 'crew/select'; id: string }
  | { type: 'compartment/select'; id: string }
  | { type: 'mission/tick'; seconds: number }
  | { type: 'mission/advance'; seconds: number }
  | { type: 'mission/paused'; paused: boolean }
  | { type: 'mission/speed'; speed: number }
  | { type: 'mission/scenario'; scenario: ScenarioId; seed: number }
  | { type: 'mission/replace'; mission: MissionState }
  | { type: 'measurements/upsert'; records: HealthMeasurement[] }
  | { type: 'assessment/add'; record: AssessmentResult }
  | { type: 'alerts/replace'; alerts: HealthAlert[] }
  | { type: 'alerts/acknowledge'; id: string }
  | { type: 'encounter/transition'; id: string; transition: 'review' | 'resolve'; at: string }
  | { type: 'encounter/follow-up'; id: string; action: ClinicalAction }
  | { type: 'notice'; message: string | null }
  | { type: 'health/command'; command: HealthCommand }
  | { type: 'fixture/reset' }
  | { type: 'sim/generate'; scenario: V3ScenarioId; seed: number; days: number }
  | { type: 'sim/advance'; hours: number }
  | { type: 'mission/configure'; profileId: string; qualifications: CrewQualification[] }
  | { type: 'rules/update'; rule: AnalysisRule }
  | { type: 'rules/reset' }

const SIM_START = '2026-10-25T00:00:00.000Z'
const CREW_IDS = ['crew-01', 'crew-02', 'crew-03']
export const DEFAULT_QUALIFICATIONS: CrewQualification[] = [{ crewId: 'crew-01', qualifications: ['basic_life_support'] }, { crewId: 'crew-02', qualifications: ['crew_medical_officer', 'basic_life_support'] }, { crewId: 'crew-03', qualifications: ['basic_life_support'] }]
export function generateSimulation(scenario: V3ScenarioId, seed: number, days: number): { simulation: HealthWorkspace; sim: SimulationState } {
  const r = simulate({ scenario, seed, days, crewIds: CREW_IDS, startAt: SIM_START })
  return { simulation: r.workspace, sim: { scenario, seed, days, startAt: SIM_START, now: r.now } }
}
/** Mission profile in force: preset + recorded crew qualifications. */
export function missionProfileOf(state: Pick<AppState, 'missionConfig'>): MissionProfile {
  const preset = MISSION_PRESETS.find(m => m.id === state.missionConfig.profileId) ?? MISSION_PRESETS[0]!
  return { ...preset, qualifications: state.missionConfig.qualifications }
}
/** "Now" for the active scope: wall clock for observed data, simulator clock for synthetic data. */
export function scopeNow(state: Pick<AppState, 'scope' | 'sim'>): string { return state.scope === 'synthetic' ? state.sim.now : new Date().toISOString() }
export function activeWorkspace(state: Pick<AppState, 'scope' | 'health' | 'simulation'>): HealthWorkspace { return state.scope === 'synthetic' ? state.simulation : state.health }

export function createAppState(): AppState {
  return { mission: initialState(), personal: { measurements: [], assessments: [], alerts: [], encounters: [] }, health: emptyWorkspace(), ...generateSimulation('sleep_disruption', 42, 21), missionConfig: { profileId: 'mars-transit', startAt: SIM_START, qualifications: DEFAULT_QUALIFICATIONS }, rules: DEMO_RULES, section: 'health', mode: 'astronaut', scope: 'observed', sessionAstronautId: 'crew-01', selectedAstronautId: 'crew-01', selectedCompartmentId: null, notice: null }
}
export function canAccessSubject(state: AppState, id: string) {
  return state.mode === 'astronaut' ? id === state.sessionAstronautId : state.mode === 'medical' || state.scope === 'synthetic'
}
// UI isolation only; real authentication and authorization require a trusted boundary.
export function selectWorkspace(state: AppState): MissionState {
  const base = state.scope === 'synthetic' ? state.mission : { ...state.mission, ...state.personal, environment: [], activities: [], events: [], crew: state.mission.crew.map(c => {
    const baselines: Partial<Record<MetricKey, number>> = {}
    const records = state.personal.measurements.filter(r => r.astronautId === c.id && r.value !== null && r.quality === 'valid').sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    for (const metric of new Set(records.map(r => r.metric))) {
      const first = records.filter(r => r.metric === metric).slice(0, 3)
      if (first.length === 3 && first.every(r => r.unit === first[0]!.unit)) baselines[metric] = first.reduce((sum, r) => sum + r.value!, 0) / 3
    }
    return { ...c, baselines }
  }) }
  if (state.mode !== 'astronaut') return base
  const own = state.sessionAstronautId
  return { ...base, crew: base.crew.filter(c => c.id === own), measurements: base.measurements.filter(r => r.astronautId === own), assessments: (base.assessments ?? []).filter(r => r.astronautId === own), encounters: (base.encounters ?? []).filter(r => r.astronautId === own), alerts: base.alerts.filter(r => r.astronautId === own), activities: base.activities.filter(r => r.astronautId === own), events: [] }
}
function updateClinical(state: AppState, data: ClinicalWorkspace): AppState {
  return state.scope === 'synthetic' ? { ...state, mission: { ...state.mission, ...data } } : { ...state, personal: data }
}
function clinicalData(state: AppState): ClinicalWorkspace { return state.scope === 'synthetic' ? state.mission : state.personal }
/** The acting role for v3 commands. Demo context switching is NOT authentication (see docs/CORE_V2.md). */
export function actorFor(state: AppState): Actor {
  if (state.mode === 'astronaut') return { role: 'astronaut', subjectId: state.sessionAstronautId }
  if (state.mode === 'medical') return { role: 'medical', subjectId: null }
  throw new Error('Health records are not edited from Mission Overview.')
}
const HEALTH_NOTICES: Record<HealthCommand['type'], string> = {
  'observation/record': 'Observation saved locally.', 'baseline/propose': 'Baseline proposed (descriptive median). Not a normal range.',
  'baseline/accept': 'Baseline accepted.', 'encounter/open': 'Concern recorded. A medical review can follow up.',
  'encounter/note': 'Note added.', 'encounter/link': 'Observations linked.', 'intervention/record': 'Action recorded. AEGIS did not select it.',
  'intervention/outcome': 'Follow-up outcome recorded.', 'encounter/close': 'Encounter closed.',
  'baseline/compute': 'New baseline version proposed. Accept it in the CMO context.', 'profile/add': 'Profile entry saved.', 'profile/resolve': 'Profile entry resolved.',
  'plan/create': 'Plan item created.', 'plan/seed': 'Demonstration plan loaded.', 'plan/status': 'Plan item updated.', 'plan/complete': 'Plan activity recorded.',
  'attention/set': 'Attention item updated.', 'encounter/priority': 'Priority updated.', 'intake/record': 'Intake recorded.', 'finding/record': 'Finding recorded.',
  'protocol/start': 'Illustrative workflow started.', 'protocol/advance': 'Step recorded.', 'decision/record': 'Decision recorded.',
  'message/send': 'Message queued for the ground (store-and-forward).', 'resources/seed': 'Demonstration inventory loaded.', 'resource/use': 'Resource use logged.',
}
function applyHealth(state: AppState, commands: HealthCommand[]): AppState {
  const actor = actorFor(state), newId = () => globalThis.crypto.randomUUID(), mission = missionProfileOf(state)
  if (state.scope === 'synthetic') {
    const at = state.sim.now
    const simulation = commands.reduce((ws, command) => applyHealthCommand(ws, command, { actor, at, newId, registry, origin: 'synthetic', mission }), state.simulation)
    return { ...state, simulation, notice: `${HEALTH_NOTICES[commands.at(-1)!.type]} (synthetic workspace)` }
  }
  const at = new Date().toISOString()
  const health = commands.reduce((ws, command) => applyHealthCommand(ws, command, { actor, at, newId, registry, mission }), state.health)
  const next = { ...state, health, personal: { ...state.personal, measurements: legacyProjection(health.observations) }, notice: HEALTH_NOTICES[commands.at(-1)!.type] }
  return reevaluate(next)
}
function reevaluate(state: AppState): AppState {
  const full = state.scope === 'synthetic' ? state.mission : { ...state.mission, ...state.personal, environment: [] }
  return updateClinical(state, synchronizeClinical(full))
}
export function appReducer(state: AppState, action: AppAction): AppState {
  try {
    switch (action.type) {
      case 'navigate':
        if ((action.section === 'spacecraft' || action.section === 'simulation') && state.mode !== 'mission') return state
        return { ...state, section: action.section }
      case 'mode/set': return { ...state, mode: action.mode, scope: action.mode === 'mission' ? 'synthetic' : 'observed', selectedAstronautId: state.sessionAstronautId, section: action.mode === 'mission' ? 'dashboard' : 'health', notice: null }
      case 'scope/set': return { ...state, scope: state.mode === 'mission' ? 'synthetic' : action.scope, notice: null }
      case 'crew/select': return canAccessSubject(state, action.id) && state.mission.crew.some(c => c.id === action.id) ? { ...state, selectedAstronautId: action.id, section: 'health' } : state
      case 'compartment/select': return state.mode === 'mission' && state.mission.compartments.some(r => r.id === action.id) ? { ...state, selectedCompartmentId: action.id } : state
      case 'mission/paused': return state.mode === 'mission' ? { ...state, mission: { ...state.mission, paused: action.paused } } : state
      case 'mission/speed': return state.mode === 'mission' && [1, 60, 300].includes(action.speed) ? { ...state, mission: { ...state.mission, speed: action.speed } } : state
      case 'mission/tick': {
        const mission = step(state.mission, action.seconds)
        return { ...state, mission: { ...mission, ...synchronizeClinical(mission) } }
      }
      case 'mission/advance': {
        if (state.mode !== 'mission') return state
        const mission = step({ ...state.mission, paused: false }, action.seconds)
        mission.paused = state.mission.paused
        return { ...state, mission: { ...mission, ...synchronizeClinical(mission) } }
      }
      case 'mission/scenario': {
        if (state.mode !== 'mission' || !Number.isInteger(action.seed) || action.seed < 0 || action.seed > 4294967295) return state
        const fresh = runScenario({ ...state.mission, seed: action.seed }, action.scenario)
        return { ...state, mission: fresh, selectedCompartmentId: null, notice: 'Synthetic scenario reset. Personal observations and assessments were preserved.' }
      }
      case 'mission/replace': {
        if (state.mode !== 'mission') return state
        const mission = { ...action.mission, assessments: action.mission.assessments ?? [], encounters: action.mission.encounters ?? [], sources: action.mission.sources ?? [], resources: action.mission.resources ?? [] }
        return { ...state, mission: { ...mission, ...synchronizeClinical(mission) }, selectedAstronautId: mission.crew.some(c => c.id === state.selectedAstronautId) ? state.selectedAstronautId : mission.crew[0]?.id ?? null }
      }
      case 'health/command': return applyHealth(state, [action.command])
      case 'measurements/upsert': {
        if (state.scope === 'observed') {
          // v2 entry point retained for compatibility: observed records are stored as v3 observations.
          const unique = [...new Map(action.records.map(r => [r.id, r])).values()]
          const commands = unique.map(validateMeasurement).map(r => {
            const record = fromLegacy(r)
            if (!record) throw new Error(`${r.metric} has no v3 parameter yet.`)
            return { type: 'observation/record' as const, record }
          }).filter(c => !state.health.observations.some(o => o.id === c.record.id))
          return commands.length ? applyHealth(state, commands) : { ...state, notice: 'Observation already saved.' }
        }
        const data = clinicalData(state), records = action.records.map(validateMeasurement)
        if (records.some(r => !canAccessSubject(state, r.astronautId) || r.origin !== state.scope || !state.mission.crew.some(c => c.id === r.astronautId))) throw new Error('Record subject or origin does not match this workspace.')
        const measurements = [...new Map([...data.measurements, ...records].map(r => [r.id, r])).values()]
        return reevaluate(updateClinical({ ...state, notice: 'Observation saved locally.' }, { ...data, measurements }))
      }
      case 'assessment/add': {
        const record = assessmentSchema.parse(action.record) as AssessmentResult
        if (state.scope !== 'observed' || record.origin !== 'observed' || !canAccessSubject(state, record.astronautId)) throw new Error('Live assessments are saved only in the observed workspace.')
        const data = state.personal
        return reevaluate({ ...state, personal: { ...data, assessments: [...data.assessments.filter(a => a.id !== record.id), record] }, notice: 'Assessment saved locally. No diagnosis is inferred.' })
      }
      case 'alerts/replace': {
        const data = clinicalData(state), read = new Set(data.alerts.filter(a => a.status === 'acknowledged').map(a => a.id))
        return updateClinical(state, { ...data, alerts: action.alerts.map(a => read.has(a.id) ? { ...a, status: 'acknowledged' } : a) })
      }
      case 'alerts/acknowledge': {
        const data = clinicalData(state)
        return updateClinical(state, { ...data, alerts: data.alerts.map(a => a.id === action.id && a.astronautId && canAccessSubject(state, a.astronautId) ? { ...a, status: 'acknowledged' } : a) })
      }
      case 'encounter/transition': {
        const data = clinicalData(state)
        if (action.transition === 'resolve' && state.mode !== 'medical') throw new Error('Case resolution requires the medical officer review context.')
        return updateClinical(state, { ...data, encounters: data.encounters.map(e => e.id === action.id && canAccessSubject(state, e.astronautId) ? transitionEncounter(e, action.transition, action.at) : e) })
      }
      case 'encounter/follow-up': {
        const data = clinicalData(state)
        const followUp = actionSchema.parse(action.action) as ClinicalAction
        return updateClinical(state, { ...data, encounters: data.encounters.map(e => e.id === action.id && canAccessSubject(state, e.astronautId) ? addFollowUp(e, followUp) : e) })
      }
      case 'notice': return { ...state, notice: action.message }
      case 'fixture/reset': return { ...state, mission: initialState(state.mission.seed), notice: 'Synthetic mission reset; observed records preserved.' }
      case 'sim/generate': {
        if (!Number.isInteger(action.seed) || action.seed < 0 || action.seed > 4294967295) throw new Error('Seed must be a whole number ≥ 0.')
        return { ...state, ...generateSimulation(action.scenario, action.seed, action.days), notice: `Synthetic workspace regenerated (${action.scenario}, seed ${action.seed}, ${action.days} days). Observed records untouched.` }
      }
      case 'sim/advance': {
        if (!(action.hours > 0 && action.hours <= 24 * 30)) throw new Error('Advance between 1 hour and 30 days.')
        return { ...state, sim: { ...state.sim, now: new Date(Date.parse(state.sim.now) + action.hours * 3_600_000).toISOString() }, notice: `Simulator clock advanced ${action.hours} h. No new synthetic readings are generated by advancing.` }
      }
      case 'mission/configure': {
        if (state.mode !== 'medical') throw new Error('Mission medical configuration is changed in the CMO context.')
        if (!MISSION_PRESETS.some(m => m.id === action.profileId)) throw new Error('Unknown mission profile.')
        return { ...state, missionConfig: { ...state.missionConfig, profileId: action.profileId, qualifications: action.qualifications }, notice: 'Mission configuration updated.' }
      }
      case 'rules/update': {
        if (state.mode !== 'medical') throw new Error('Analysis rules are configured in the CMO context.')
        const prev = state.rules.find(r => r.id === action.rule.id)
        if (!prev) throw new Error('Unknown rule.')
        if (action.rule.status === 'approved') throw new Error('AEGIS cannot mark a rule approved; that requires the mission medical authority.')
        const next = { ...action.rule, version: prev.version + 1, configuredByRole: 'medical' as const }
        const problems = ruleProblems(next, state.rules, registry)
        if (problems.length) throw new Error(problems.join(' '))
        return { ...state, rules: state.rules.map(r => r.id === next.id ? next : r), notice: `Rule ${next.id} updated to v${next.version}.` }
      }
      case 'rules/reset': return state.mode === 'medical' ? { ...state, rules: DEMO_RULES, notice: 'Rules reset to the shipped demonstration set.' } : state
    }
  } catch (error) { return { ...state, notice: `Not saved: ${error instanceof Error ? error.message : 'Invalid data'}` } }
}
