import { z } from 'zod'
import type { HealthMeasurement } from '../../../contracts/types'
import { clinicalSchema, missionSchema } from '../../shared/validation'
import { legacyProjection, migrateFromV2, parseWorkspace, registry, workspaceSchema } from '../../domain'
import { createAppState } from './reducer'
import type { AppState } from './reducer'

export const STORAGE_KEY = 'aegis.core.v3'
/** Core v2 key. Read once for migration; never written or deleted by v3. */
export const LEGACY_STORAGE_KEY = 'aegis.core.v2'

const baseSchema = z.object({ mission: missionSchema, personal: clinicalSchema,
  section: z.enum(['dashboard', 'health', 'spacecraft', 'simulation', 'events', 'assessments', 'research']), mode: z.enum(['astronaut', 'medical', 'mission']), scope: z.enum(['observed', 'synthetic']), sessionAstronautId: z.literal('crew-01'), selectedAstronautId: z.string().nullable(), selectedCompartmentId: z.string().nullable(), notice: z.string().nullable(),
})
type BaseState = z.infer<typeof baseSchema>
function integrity(state: BaseState, ctx: z.RefinementCtx) {
  if (state.personal.measurements.some(r => r.origin !== 'observed') || state.personal.assessments.some(r => r.origin !== 'observed') || state.personal.encounters.some(r => r.origin !== 'observed')) ctx.addIssue({ code: 'custom', message: 'Personal workspace contains non-observed data' })
  if (state.mission.measurements.some(r => r.origin !== 'synthetic') || state.mission.assessments.some(r => r.origin !== 'synthetic') || state.mission.environment.some(r => r.origin !== 'synthetic')) ctx.addIssue({ code: 'custom', message: 'Simulation contains non-synthetic data' })
  for (const workspace of [state.personal, state.mission]) {
    const records = [...workspace.measurements, ...workspace.assessments]
    if (new Set(records.map(r => r.id)).size !== records.length) ctx.addIssue({ code: 'custom', message: 'Duplicate record ID' })
    if (records.some(r => !state.mission.crew.some(c => c.id === r.astronautId))) ctx.addIssue({ code: 'custom', message: 'Unknown astronaut reference' })
  }
}
export const legacyStateSchema = baseSchema.superRefine(integrity)
const ts = z.iso.datetime({ offset: true })
const qualificationsSchema = z.array(z.object({ crewId: z.string().min(1), qualifications: z.array(z.enum(['crew_medical_officer', 'physician_level', 'basic_life_support'])) }))
const ruleSchema = z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string(), condition: z.record(z.string(), z.unknown()).and(z.object({ type: z.enum(['baseline_deviation', 'stale_data', 'trend', 'plan_adherence', 'combination', 'reference_value', 'demo_cutoff']) })), status: z.enum(['demonstration', 'approved', 'disabled']), basis: z.string().min(1), configuredByRole: z.enum(['astronaut', 'medical', 'system']), sourceRefIds: z.array(z.string()), version: z.number().int().positive() })
const fresh = () => createAppState()
export const stateSchema = baseSchema.extend({
  health: workspaceSchema,
  // v3.1 additions default to a fresh setup when restoring an earlier v3 save.
  simulation: workspaceSchema.optional(),
  sim: z.object({ scenario: z.enum(['nominal', 'sleep_disruption', 'deconditioning', 'hydration_shortfall']), seed: z.number().int().min(0), days: z.number().int().min(1).max(120), startAt: ts, now: ts }).optional(),
  missionConfig: z.object({ profileId: z.string().min(1), startAt: ts, qualifications: qualificationsSchema }).optional(),
  rules: z.array(ruleSchema).optional(),
}).transform(s => {
  const f = s.simulation && s.sim ? null : fresh()
  return { ...s, simulation: s.simulation ?? f!.simulation, sim: s.sim ?? f!.sim, missionConfig: s.missionConfig ?? fresh().missionConfig, rules: (s.rules as AppState['rules'] | undefined) ?? fresh().rules }
}).superRefine((state, ctx) => {
  integrity(state, ctx)
  try { parseWorkspace(state.health, registry) } catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'Invalid health workspace' }) }
  if (state.health.observations.some(o => o.origin !== 'observed' || !state.mission.crew.some(c => c.id === o.subjectId))) ctx.addIssue({ code: 'custom', message: 'Health workspace contains non-observed or unknown-subject records' })
  try { parseWorkspace(state.simulation, registry) } catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'Invalid synthetic workspace' }) }
  if (state.simulation.observations.some(o => o.origin !== 'synthetic')) ctx.addIssue({ code: 'custom', message: 'Synthetic workspace contains non-synthetic records' })
})

const restored = (state: Omit<AppState, 'notice'>, notice: string): AppState => ({ ...state, mode: 'astronaut', scope: 'observed', section: 'health', selectedAstronautId: 'crew-01', mission: { ...state.mission, paused: true }, notice })

export function restoreState(storage: Pick<Storage, 'getItem'>): { state: AppState | null; error: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = z.object({ version: z.literal(3), state: stateSchema }).parse(JSON.parse(raw))
      return { state: restored(parsed.state as AppState, 'Saved records restored. Mission paused.'), error: null }
    }
    const legacy = storage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return { state: null, error: null }
    const parsed = z.object({ version: z.literal(2), state: legacyStateSchema }).parse(JSON.parse(legacy))
    const { workspace, skipped } = migrateFromV2(parsed.state.personal.measurements as HealthMeasurement[], registry)
    const health = { ...workspace, audit: workspace.observations.length ? [{ id: 'migration-v2', at: new Date().toISOString(), role: 'system' as const, action: 'migrate/v2-to-v3', recordIds: workspace.observations.map(o => o.id) }] : [] }
    const state = { ...createAppState(), ...parsed.state, health, personal: { ...parsed.state.personal, measurements: legacyProjection(health.observations) } } as AppState
    return { state: restored(state, `Core v2 records migrated to the v3 health model${skipped.length ? `; ${skipped.length} record(s) without a v3 parameter were left in the v2 copy` : ''}. The v2 copy is unchanged. Mission paused.`), error: null }
  } catch { return { state: null, error: 'Saved data could not be validated. It has been retained unchanged. Download the saved data or explicitly replace it before saving new records.' } }
}
export function persistState(storage: Pick<Storage, 'setItem'>, state: AppState) {
  stateSchema.parse(state)
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state }))
}
