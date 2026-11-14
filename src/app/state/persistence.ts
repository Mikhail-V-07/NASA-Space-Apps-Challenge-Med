import { z } from 'zod'
import type { HealthMeasurement } from '../../../contracts/types'
import { clinicalSchema, missionSchema } from '../../shared/validation'
import { legacyProjection, migrateFromV2, parseWorkspace, registry, workspaceSchema } from '../../domain'
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
export const stateSchema = baseSchema.extend({ health: workspaceSchema }).superRefine((state, ctx) => {
  integrity(state, ctx)
  try { parseWorkspace(state.health, registry) } catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'Invalid health workspace' }) }
  if (state.health.observations.some(o => o.origin !== 'observed' || !state.mission.crew.some(c => c.id === o.subjectId))) ctx.addIssue({ code: 'custom', message: 'Health workspace contains non-observed or unknown-subject records' })
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
    const state = { ...parsed.state, health, personal: { ...parsed.state.personal, measurements: legacyProjection(health.observations) } } as AppState
    return { state: restored(state, `Core v2 records migrated to the v3 health model${skipped.length ? `; ${skipped.length} record(s) without a v3 parameter were left in the v2 copy` : ''}. The v2 copy is unchanged. Mission paused.`), error: null }
  } catch { return { state: null, error: 'Saved data could not be validated. It has been retained unchanged. Download the saved data or explicitly replace it before saving new records.' } }
}
export function persistState(storage: Pick<Storage, 'setItem'>, state: AppState) {
  stateSchema.parse(state)
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state }))
}
