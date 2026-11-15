import type { Baseline, HealthWorkspace, Observation } from '../../contracts/types'
import { DEFAULT_BASELINE_POLICY, computeBaseline, createObservation, demonstrationInventory, demonstrationPlans, emptyWorkspace, registry, series } from '../domain'

/**
 * AEGIS v3 mission simulator — SYNTHETIC DATA ONLY.
 *
 * Generates a reproducible multi-day health workspace (seeded PRNG) that feeds the same analytics,
 * prevention, rules and clinical workflows as observed data. Values are display-plausible numbers
 * chosen by the project team to exercise the software; they are NOT physiological predictions and
 * scenario effects do not model any real condition. Every record is origin 'synthetic',
 * source 'mission-simulator', demonstrationOnly true.
 */

export type V3ScenarioId = 'nominal' | 'sleep_disruption' | 'deconditioning' | 'hydration_shortfall'
export const V3_SCENARIOS: { id: V3ScenarioId; label: string; description: string }[] = [
  { id: 'nominal', label: 'Nominal', description: 'Stable synthetic series with noise, occasional missing logs.' },
  { id: 'sleep_disruption', label: 'Sleep disruption', description: 'From day 8 one crew member logs shorter sleep, higher fatigue and a higher resting HR.' },
  { id: 'deconditioning', label: 'Reduced exercise', description: 'From day 6 one crew member logs less exercise; body mass drifts down and resting HR up.' },
  { id: 'hydration_shortfall', label: 'Missed intake logs', description: 'From day 10 one crew member logs fluid less often and in smaller amounts; plan adherence drops.' },
]

export interface SimulationConfig { scenario: V3ScenarioId; seed: number; crewIds: string[]; startAt: string; days: number; affectedCrewId?: string }
export interface SimulationResult { workspace: HealthWorkspace; now: string; config: SimulationConfig }

/** mulberry32: small deterministic PRNG. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const HOUR = 3_600_000, DAY = 24 * HOUR

export function simulate(config: SimulationConfig): SimulationResult {
  if (!Number.isInteger(config.seed) || config.seed < 0) throw new Error('Seed must be a non-negative integer.')
  if (!(config.days >= 1 && config.days <= 120)) throw new Error('Simulate between 1 and 120 days.')
  const rnd = prng(config.seed)
  const gauss = () => { const u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  let n = 0
  const newId = () => `sim-${config.seed}-${(++n).toString(36)}`
  const start = Date.parse(config.startAt), now = new Date(start + config.days * DAY).toISOString()
  const affected = config.affectedCrewId ?? config.crewIds[0]
  const ws = emptyWorkspace()
  const obs: Observation[] = []
  const at = (day: number, hour: number) => new Date(start + day * DAY + hour * HOUR + Math.round(rnd() * 20) * 60_000).toISOString()
  const add = (subjectId: string, parameterId: string, day: number, hour: number, value: number | null, round = 1, quality?: Observation['quality']) => {
    const t = at(day, hour)
    const p = registry.parameter(parameterId)!
    const v = value === null ? null : p.valueType === 'ordinal' ? Math.max(p.scale!.min, Math.min(p.scale!.max, Math.round(value))) : Math.max(p.entry?.min ?? -Infinity, Math.min(p.entry?.max ?? Infinity, Number(value.toFixed(round))))
    obs.push(createObservation({ id: newId(), subjectId, parameterId, value: v, effectiveAt: t, recordedAt: t, sourceId: 'mission-simulator', method: 'simulator', origin: 'synthetic', ...(quality ? { quality } : {}), demonstrationOnly: true }, registry))
  }

  config.crewIds.forEach((crewId, i) => {
    // Per-person synthetic set points (display values, not physiological norms).
    const sp = { rhr: 60 + i * 4 + gauss() * 2, sleep: 7.4 + gauss() * 0.3, mass: 68 + i * 7 + gauss() * 2, sbp: 114 + i * 3, dbp: 72 + i * 2, temp: 33.4 + gauss() * 0.2, spo2: 98, rr: 14 + i, ex: 120 }
    const hit = crewId === affected
    for (let d = 0; d < config.days; d++) {
      const s = config.scenario
      const sleepEff = hit && s === 'sleep_disruption' && d >= 8 ? -1.6 - (d - 8) * 0.05 : 0
      const decond = hit && s === 'deconditioning' && d >= 6 ? d - 6 : 0
      const hydro = hit && s === 'hydration_shortfall' && d >= 10
      const rhrEff = (sleepEff ? 7 : 0) + decond * 0.6
      // Morning
      const skipRhr = rnd() < 0.06
      if (skipRhr) add(crewId, 'resting_hr', d, 7, null)
      else add(crewId, 'resting_hr', d, 7, sp.rhr + rhrEff + gauss() * 1.8, 0)
      add(crewId, 'sleep_duration', d, 7.2, sp.sleep + sleepEff + gauss() * 0.35, 1)
      add(crewId, 'fatigue', d, 7.5, 2 + (sleepEff ? 5 : 0) + decond * 0.15 + gauss() * 0.8)
      add(crewId, 'mood', d, 7.5, 7 - (sleepEff ? 2 : 0) + gauss() * 0.8)
      add(crewId, 'stress', d, 7.5, 3 + (sleepEff ? 2 : 0) + gauss() * 0.8)
      if (d % 2 === 0) { add(crewId, 'sbp', d, 8, sp.sbp + gauss() * 4, 0); add(crewId, 'dbp', d, 8, sp.dbp + gauss() * 3, 0) }
      if (d % 3 === 0) add(crewId, 'body_mass', d, 7.8, sp.mass - decond * 0.12 + gauss() * 0.15, 1)
      add(crewId, 'spo2', d, 8.2, Math.min(100, sp.spo2 + gauss() * 0.6), 0)
      add(crewId, 'rr', d, 8.2, sp.rr + gauss() * 1, 0)
      add(crewId, 'skin_temp', d, 8.3, sp.temp + gauss() * 0.25, 1)
      // Exercise
      const exMin = decond ? Math.max(0, sp.ex - 55 - decond * 3 + gauss() * 10) : sp.ex + gauss() * 12
      if (!(decond && rnd() < 0.35)) add(crewId, 'exercise_duration', d, 14, exMin, 0)
      add(crewId, 'hr', d, 14.5, 120 + gauss() * 10, 0)
      // Intake: three logs per day (aligned to 8-hour plan slots)
      for (const h of [1, 9, 17]) {
        if (hydro && rnd() < 0.55) continue
        if (!hydro && rnd() < 0.05) continue
        add(crewId, 'fluid_intake', d, h, (hydro ? 380 : 750) + gauss() * 80, 0)
      }
      for (const h of [8, 13, 19]) add(crewId, 'energy_intake', d, h, 800 + gauss() * 90, 0)
    }
    if (rnd() < 0.8) obs.push({ ...createObservation({ id: newId(), subjectId: crewId, parameterId: 'skin_temp', value: 12.0, effectiveAt: at(Math.floor(config.days / 2), 21), recordedAt: at(Math.floor(config.days / 2), 21), sourceId: 'mission-simulator', method: 'simulator', origin: 'synthetic', demonstrationOnly: true, context: { note: 'Simulated sensor fault, flagged invalid.' } }, registry), quality: 'invalid' })
  })
  obs.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
  ws.observations = obs

  // Demonstration plans, inventory and profile.
  const seedAt = config.startAt
  ws.plans = config.crewIds.flatMap(c => demonstrationPlans(c, seedAt, newId, seedAt))
  ws.resources = demonstrationInventory(seedAt)
  ws.profile = config.crewIds.flatMap(c => [{ id: newId(), subjectId: c, kind: 'history' as const, text: 'Synthetic profile entry: no significant history recorded (simulator).', recordedAt: seedAt, byRole: 'medical' as const, status: 'active' as const, demonstrationOnly: true }])

  // Simulator-seeded baselines from the first week (shown as accepted so deviation rules can run).
  const baselines: Baseline[] = []
  const firstWeek = new Date(start + 7 * DAY).toISOString()
  for (const c of config.crewIds) for (const pid of ['resting_hr', 'sleep_duration', 'body_mass']) {
    const s = series(obs, { subjectId: c, parameterId: pid, origin: 'synthetic', to: firstWeek })
    try {
      const policy = { ...DEFAULT_BASELINE_POLICY, minReadings: pid === 'body_mass' ? 3 : DEFAULT_BASELINE_POLICY.minReadings, dataset: { type: 'window' as const, from: config.startAt, to: firstWeek } }
      const b = computeBaseline(s, policy, { id: newId(), at: firstWeek, byRole: 'medical', existing: baselines, note: 'Seeded by the simulator from the first synthetic week for demonstration.' })
      baselines.push({ ...b, status: 'accepted' })
    } catch { /* too few synthetic readings: no baseline, shown as such */ }
  }
  ws.baselines = baselines
  ws.audit = [{ id: newId(), at: now, role: 'system', action: `simulate/${config.scenario}:seed=${config.seed}`, recordIds: [] }]
  return { workspace: ws, now, config }
}
