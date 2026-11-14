import { describe, expect, it } from 'vitest'
import type { ParameterDefinition } from '../../contracts/types'
import { CATEGORIES, PARAMETERS, SOURCES, UNITS, createRegistry, registry, registryProblems } from './registry'
import { createObservation, createWaveformObservation, formatValue, validateObservation } from './observations'
import { activeBaseline, differenceFromBaseline, proposeBaseline, series, summarize } from './series'
import { closeEncounter, followUpState, openEncounter, recordIntervention, recordOutcome } from './care'
import { fromLegacy, toLegacy } from './legacy'
import { applyHealthCommand, emptyWorkspace, migrateFromV2, parseWorkspace, visibleTo } from './workspace'
import type { CommandContext } from './workspace'

const T0 = '2026-11-15T08:00:00.000Z'
const at = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString()
let seq = 0
const nextId = () => `id-${++seq}`
const obs = (parameterId: string, value: number | null, h = 0, extra: Partial<Parameters<typeof createObservation>[0]> = {}) => createObservation({
  id: nextId(), subjectId: 'crew-01', parameterId, value, effectiveAt: at(h), recordedAt: at(h), sourceId: 'manual-entry', method: 'manual', origin: 'observed', ...extra,
}, registry)

describe('parameter registry', () => {
  it('contains the initial parameter list as data and is internally consistent', () => {
    expect(registryProblems({ categories: CATEGORIES, units: UNITS, sources: SOURCES, parameters: PARAMETERS })).toEqual([])
    for (const id of ['hr', 'ecg', 'rri', 'sbp', 'dbp', 'spo2', 'pr', 'rr', 'vt', 'ptcco2', 'skin_temp', 'body_mass', 'pal', 'body_movement']) expect(registry.parameter(id)).toBeDefined()
  })
  it('keeps HR/PR and RRI/RR distinct and disambiguated', () => {
    const [hr, pr, rri, rr] = ['hr', 'pr', 'rri', 'rr'].map(id => registry.parameter(id)!)
    expect(hr!.code).not.toBe(pr!.code); expect(rri!.code).not.toBe(rr!.code)
    expect(rri!.canonicalUnitId).toBe('ms'); expect(rr!.canonicalUnitId).toBe('breaths_per_min')
    for (const p of [hr, pr, rri, rr]) expect(p!.disambiguation).toBeTruthy()
  })
  it('marks parameters with undefined units as provisional and blocks recording', () => {
    expect(registry.parameter('pal')!.status).toBe('provisional')
    expect(() => obs('pal', 1)).toThrow()
  })
  it('accepts a new parameter without code changes and rejects inconsistent definitions', () => {
    const extra: ParameterDefinition = { id: 'core_temp', code: 'Tcore', displayName: 'Core temperature', categoryId: 'physical', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'degC', acceptedUnitIds: ['degC'], potentialSourceIds: ['manual-entry'], manualEntry: true, visualization: 'line', status: 'active', description: 'test', provenance: 'test', sourceRefIds: [], version: 1 }
    const r = createRegistry({ categories: CATEGORIES, units: UNITS, sources: SOURCES, parameters: [...PARAMETERS, extra] })
    const o = createObservation({ id: 'x', subjectId: 'crew-01', parameterId: 'core_temp', value: 36.9, effectiveAt: T0, recordedAt: T0, sourceId: 'manual-entry', method: 'manual', origin: 'observed' }, r)
    expect(formatValue(o, r)).toBe('36.9 °C')
    expect(() => createRegistry({ categories: CATEGORIES, units: UNITS, sources: SOURCES, parameters: [...PARAMETERS, { ...extra, acceptedUnitIds: ['degC', 'kg'] }] })).toThrow(/no exact conversion/)
    expect(() => createRegistry({ categories: CATEGORIES, units: UNITS, sources: SOURCES, parameters: [...PARAMETERS, { ...extra, code: 'HR' }] })).toThrow(/duplicate parameter code/)
  })
  it('ships no clinical reference values', () => {
    expect(PARAMETERS.every(p => !p.entry || p.entry.basis === 'definitional')).toBe(true)
  })
})

describe('observations', () => {
  it('converts accepted units exactly and keeps the original', () => {
    const vt = obs('vt', 0.5, 0, { unitId: 'L' })
    expect(vt.value).toEqual({ type: 'quantity', value: 500, unitId: 'mL' }); expect(vt.original).toEqual({ value: 0.5, unitId: 'L' })
    const co2 = obs('ptcco2', 101.325 / 760 * 40, 0, { unitId: 'kPa' })
    expect(co2.value?.type === 'quantity' && Math.abs(co2.value.value - 40) < 1e-9).toBe(true)
  })
  it('distinguishes missing from zero and rejects definitional violations', () => {
    expect(obs('sleep_duration', 0).value).toEqual({ type: 'quantity', value: 0, unitId: 'h' })
    const missing = obs('hr', null); expect(missing.quality).toBe('missing'); expect(formatValue(missing, registry)).toBe('No data')
    expect(() => obs('spo2', 101)).toThrow(/not a health range/)
    expect(() => obs('fatigue', 11)).toThrow(); expect(() => obs('fatigue', 4.5)).toThrow()
    expect(() => validateObservation({ ...obs('hr', 60), quality: 'missing' }, registry)).toThrow(/Missing is never zero/)
  })
  it('requires notes where defined and rejects raw signals as typed values', () => {
    expect(() => obs('symptom_severity', 3)).toThrow(/note/)
    expect(obs('symptom_severity', 3, 0, { context: { note: 'headache' } }).context?.note).toBe('headache')
    expect(() => obs('ecg', 1)).toThrow(/raw signal/)
  })
  it('stores waveforms as raw samples without interpretation', () => {
    const w = createWaveformObservation({ id: 'w1', subjectId: 'crew-01', parameterId: 'ecg', samples: [0, 0.1, 0.4], sampleRateHz: 250, unitId: 'mV', effectiveAt: T0, recordedAt: T0, sourceId: 'file-import', method: 'dataset_import', origin: 'observed' }, registry)
    expect(formatValue(w, registry)).toBe('3 samples @ 250 Hz')
  })
  it('rejects simulator data labelled as observed', () => {
    expect(() => obs('hr', 60, 0, { method: 'simulator', sourceId: 'mission-simulator' })).toThrow(/synthetic/)
  })
})

describe('longitudinal series and baselines', () => {
  const records = [obs('rr', 14, 1), obs('rr', 16, 2), obs('rr', 15, 3), obs('rr', null, 4), obs('rr', 20, 5)]
  it('orders, filters unusable readings and summarises descriptively', () => {
    const s = series(records, { subjectId: 'crew-01', parameterId: 'rr', origin: 'observed' })
    expect(s.map(o => o.value?.type === 'quantity' ? o.value.value : null)).toEqual([14, 16, 15, 20])
    expect(summarize(s)).toMatchObject({ n: 4, min: 14, max: 20, median: 15.5 })
  })
  it('proposes a median baseline only from enough valid same-origin readings', () => {
    expect(() => proposeBaseline(records.slice(0, 2), { id: 'b0', at: T0, byRole: 'astronaut' })).toThrow(/At least 3/)
    const b = proposeBaseline(records.slice(0, 3), { id: 'b1', at: T0, byRole: 'astronaut' })
    expect(b).toMatchObject({ value: 15, status: 'proposed', summary: { n: 3, min: 14, max: 16 } })
    const d = differenceFromBaseline(records[4]!, b)!
    expect(d.absolute).toBe(5); expect(d.withinBaselineSpread).toBe(false)
    expect(Math.abs(d.relativePercent! - 100 / 3) < 1e-9).toBe(true)
  })
})

describe('care workflow authority', () => {
  const evidence = obs('sleep_duration', 4, 1)
  const e = openEncounter({ id: 'e1', subjectId: 'crew-01', origin: 'observed', at: at(2), byRole: 'astronaut', concern: 'Poor sleep for three nights', trigger: { type: 'self_report', refIds: [] }, observationIds: [evidence.id] })
  it('lets astronauts record only self-care actions and never marks unapproved protocols approved', () => {
    expect(() => recordIntervention(e, { id: 'i0', kind: 'medication', description: 'x', protocol: { status: 'none' }, at: at(3), byRole: 'astronaut', followUp: null })).toThrow(/Crew Medical Officer/)
    expect(() => recordIntervention(e, { id: 'i0', kind: 'monitoring', description: 'x', protocol: { status: 'approved', reference: 'P-1' }, at: at(3), byRole: 'medical', followUp: null })).toThrow(/approved protocol/)
    expect(() => recordIntervention(e, { id: 'i0', kind: 'monitoring', description: 'x', protocol: { status: 'none' }, at: at(3), byRole: 'system', followUp: null })).toThrow(/people/)
  })
  it('tracks follow-up from scheduled to evidence to assessed and requires closure by the CMO', () => {
    const { encounter, intervention } = recordIntervention(e, { id: 'i1', kind: 'activity_adjustment', description: 'Earlier lights-out for three nights', protocol: { status: 'none' }, at: at(3), byRole: 'astronaut', followUp: { dueAt: at(72), parameterIds: ['sleep_duration'] } })
    expect(encounter.status).toBe('monitoring')
    expect(followUpState(intervention, [evidence], at(10))).toBe('scheduled')
    expect(followUpState(intervention, [evidence], at(80))).toBe('due')
    const later = obs('sleep_duration', 7, 75)
    expect(followUpState(intervention, [evidence, later], at(80))).toBe('evidence_available')
    expect(() => recordOutcome(intervention, { at: at(80), byRole: 'astronaut', result: 'improved', note: 'ok', observationIds: [later.id] }, [later])).toThrow(/Crew Medical Officer/)
    expect(() => recordOutcome(intervention, { at: at(80), byRole: 'medical', result: 'improved', note: 'ok', observationIds: [evidence.id] }, [evidence, later])).toThrow(/after the intervention/)
    expect(() => closeEncounter(encounter, [intervention], { at: at(81), byRole: 'medical', closure: 'done' })).toThrow(/outcome/)
    const assessed = recordOutcome(intervention, { at: at(80), byRole: 'medical', result: 'improved', note: 'Sleep entries longer after the adjustment', observationIds: [later.id] }, [evidence, later])
    expect(() => closeEncounter(encounter, [assessed], { at: at(81), byRole: 'astronaut', closure: 'done' })).toThrow()
    expect(closeEncounter(encounter, [assessed], { at: at(81), byRole: 'medical', closure: 'Reviewed; no further action' }).status).toBe('closed')
  })
})

describe('workspace commands', () => {
  const ctx = (role: 'astronaut' | 'medical', subjectId: string | null = 'crew-01'): CommandContext => ({ actor: { role, subjectId }, at: at(1), newId: nextId, registry })
  it('runs the vertical slice: record → baseline → concern → intervention → outcome → close, with audit', () => {
    let ws = emptyWorkspace()
    const readings = [obs('hr', 60, 1), obs('hr', 62, 2), obs('hr', 64, 3)]
    for (const r of readings) ws = applyHealthCommand(ws, { type: 'observation/record', record: r }, ctx('astronaut'))
    ws = applyHealthCommand(ws, { type: 'baseline/propose', subjectId: 'crew-01', parameterId: 'hr', observationIds: readings.map(r => r.id) }, ctx('astronaut'))
    expect(() => applyHealthCommand(ws, { type: 'baseline/accept', baselineId: ws.baselines[0]!.id }, ctx('astronaut'))).toThrow()
    ws = applyHealthCommand(ws, { type: 'baseline/accept', baselineId: ws.baselines[0]!.id }, ctx('medical', null))
    expect(activeBaseline(ws.baselines, 'crew-01', 'hr')?.status).toBe('accepted')
    ws = applyHealthCommand(ws, { type: 'encounter/open', subjectId: 'crew-01', concern: 'Felt light-headed after exercise', trigger: { type: 'self_report', refIds: [] }, observationIds: [readings[2]!.id] }, ctx('astronaut'))
    const encounterId = ws.encounters[0]!.id
    ws = applyHealthCommand(ws, { type: 'intervention/record', encounterId, input: { kind: 'monitoring', description: 'Repeat HR at rest tomorrow', protocol: { status: 'none' }, followUp: { dueAt: at(24), parameterIds: ['hr'] } } }, ctx('medical', null))
    const follow = obs('hr', 61, 25)
    ws = applyHealthCommand(ws, { type: 'observation/record', record: follow }, ctx('astronaut'))
    ws = applyHealthCommand(ws, { type: 'intervention/outcome', interventionId: ws.interventions[0]!.id, result: 'unchanged', note: 'Repeat reading recorded', observationIds: [follow.id] }, ctx('medical', null))
    ws = applyHealthCommand(ws, { type: 'encounter/close', encounterId, closure: 'Reviewed' }, ctx('medical', null))
    expect(ws.encounters[0]!.status).toBe('closed')
    expect(ws.audit.map(a => a.action)).toEqual(['observation/record', 'observation/record', 'observation/record', 'baseline/propose', 'baseline/accept', 'encounter/open', 'intervention/record', 'observation/record', 'intervention/outcome', 'encounter/close'])
    expect(parseWorkspace(JSON.parse(JSON.stringify(ws)), registry)).toEqual(ws)
  })
  it('rejects writing another subject and scopes reads', () => {
    let ws = emptyWorkspace()
    expect(() => applyHealthCommand(ws, { type: 'observation/record', record: obs('hr', 60, 1, { subjectId: 'crew-02' }) }, ctx('astronaut'))).toThrow(/own/)
    ws = applyHealthCommand(ws, { type: 'observation/record', record: obs('hr', 60, 1, { subjectId: 'crew-02' }) }, ctx('medical', null))
    expect(visibleTo(ws, { role: 'astronaut', subjectId: 'crew-01' }).observations).toHaveLength(0)
  })
})

describe('Core v2 compatibility', () => {
  it('round-trips mappable records and migrates v2 personal measurements', () => {
    const v2 = { id: 'm1', astronautId: 'crew-01', metric: 'reported_fatigue' as const, value: 6, unit: '0–10', timestamp: T0, source: 'manual' as const, origin: 'observed' as const, quality: 'valid' as const }
    const v3 = fromLegacy(v2)!
    expect(v3.value).toEqual({ type: 'ordinal', value: 6 }); expect(toLegacy(v3)).toMatchObject({ metric: 'reported_fatigue', value: 6, unit: '0–10' })
    const { workspace, skipped } = migrateFromV2([v2, { ...v2, id: 'm2', metric: 'visual_fatigue' }], registry)
    expect(workspace.observations).toHaveLength(1); expect(skipped).toEqual(['m2'])
    expect(toLegacy(obs('spo2', 97))).toBeNull()
  })
})
