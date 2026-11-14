import { z } from 'zod'
import type { AcquisitionMethod, DataOrigin, Observation, ObservationContext, ObservationQuality, ParameterDefinition } from '../../contracts/types'
import type { Registry } from './registry'

const id = z.string().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const finite = z.number().finite()

/** Structural schema. Parameter-specific rules are checked against the registry in `checkObservation`. */
export const observationSchema = z.object({
  id, subjectId: id, parameterId: id, parameterVersion: z.number().int().positive(),
  value: z.discriminatedUnion('type', [
    z.object({ type: z.literal('quantity'), value: finite, unitId: id }),
    z.object({ type: z.literal('ordinal'), value: finite }),
    z.object({ type: z.literal('waveform'), unitId: id, sampleRateHz: finite.positive(), samples: z.array(finite).min(1).max(1_000_000) }),
  ]).nullable(),
  effectiveAt: timestamp, recordedAt: timestamp, sourceId: id,
  method: z.enum(['simulator', 'manual', 'wearable', 'environment_sensor', 'camera_pose', 'dataset_import', 'assessment']),
  origin: z.enum(['synthetic', 'observed', 'research_dataset']),
  quality: z.enum(['valid', 'estimated', 'missing', 'invalid']),
  original: z.object({ value: finite, unitId: id }).optional(),
  derivedFrom: z.object({ observationIds: z.array(id).min(1), methodId: id }).optional(),
  context: z.object({ encounterId: id.optional(), interventionId: id.optional(), compartmentId: id.optional(), condition: z.string().max(500).optional(), note: z.string().max(2000).optional() }).optional(),
  demonstrationOnly: z.boolean(),
})

/** Registry-aware integrity checks. Returns human-readable problems; empty = acceptable. */
export function checkObservation(o: Observation, registry: Registry): string[] {
  const problems: string[] = []
  const p = registry.parameter(o.parameterId)
  if (!p) return [`Unknown parameter '${o.parameterId}'.`]
  if (p.status !== 'active') problems.push(`${p.displayName} is ${p.status}; its unit or method is not yet defined.`)
  if (!registry.source(o.sourceId)) problems.push(`Unknown data source '${o.sourceId}'.`)
  if ((o.quality === 'missing') !== (o.value === null)) problems.push('A missing reading must have no value; an available reading must have a value. Missing is never zero.')
  if (o.method === 'simulator' && o.origin !== 'synthetic') problems.push('Simulator data must be marked synthetic.')
  if (o.derivedFrom && p.kind !== 'derived') problems.push(`${p.displayName} is not a derived parameter.`)
  if (p.requiresNote && !o.context?.note?.trim()) problems.push(`${p.displayName} requires a descriptive note.`)
  if (o.value) {
    if (o.value.type !== p.valueType) problems.push(`${p.displayName} expects a ${p.valueType} value.`)
    else if (o.value.type === 'quantity') {
      if (o.value.unitId !== p.canonicalUnitId) problems.push(`Store ${p.displayName} in ${p.canonicalUnitId}; convert with normalizeQuantity first.`)
      problems.push(...entryProblems(p, o.value.value))
    } else if (o.value.type === 'ordinal' && p.scale) {
      if (!Number.isInteger(o.value.value) || o.value.value < p.scale.min || o.value.value > p.scale.max) problems.push(`${p.displayName} uses whole numbers ${p.scale.min}–${p.scale.max}.`)
    } else if (o.value.type === 'waveform' && o.value.unitId !== p.canonicalUnitId) problems.push(`${p.displayName} samples must be in ${p.canonicalUnitId}.`)
  }
  return problems
}

function entryProblems(p: ParameterDefinition, value: number): string[] {
  const e = p.entry
  if (!e) return []
  const out: string[] = []
  if (e.min !== undefined && value < e.min) out.push(`${p.displayName} cannot be below ${e.min}${e.note ? ` (${e.note})` : ''}. This is input validation, not a health range.`)
  if (e.max !== undefined && value > e.max) out.push(`${p.displayName} cannot exceed ${e.max}${e.note ? ` (${e.note})` : ''}. This is input validation, not a health range.`)
  if (e.integer && !Number.isInteger(value)) out.push(`${p.displayName} must be a whole number.`)
  return out
}

/** Converts a value to the parameter's canonical unit using exact registry conversions only. */
export function normalizeQuantity(p: ParameterDefinition, value: number, unitId: string, registry: Registry): { value: number; unitId: string; original?: { value: number; unitId: string } } {
  if (p.canonicalUnitId === null) throw new Error(`${p.displayName} has no defined unit yet.`)
  if (!p.acceptedUnitIds.includes(unitId)) throw new Error(`${p.displayName} does not accept unit '${unitId}'.`)
  if (unitId === p.canonicalUnitId) return { value, unitId }
  const conv = registry.unit(unitId)?.toCanonical
  if (!conv) throw new Error(`No exact conversion from '${unitId}'.`)
  return { value: value * conv.factor + conv.offset, unitId: p.canonicalUnitId, original: { value, unitId } }
}

export interface ObservationInput {
  id: string
  subjectId: string
  parameterId: string
  /** Number for quantity/ordinal parameters, null to record an explicitly missing reading. */
  value: number | null
  unitId?: string
  effectiveAt: string
  recordedAt: string
  sourceId: string
  method: AcquisitionMethod
  origin: DataOrigin
  quality?: ObservationQuality
  context?: ObservationContext
  demonstrationOnly?: boolean
}

/** Builds and validates a scalar observation. Throws an Error listing every problem. */
export function createObservation(input: ObservationInput, registry: Registry): Observation {
  const p = registry.parameter(input.parameterId)
  if (!p) throw new Error(`Unknown parameter '${input.parameterId}'.`)
  if (p.valueType === 'waveform') throw new Error(`${p.displayName} is a raw signal; use createWaveformObservation.`)
  let value: Observation['value'] = null, original: Observation['original']
  if (input.value !== null) {
    if (!Number.isFinite(input.value)) throw new Error('Enter a finite number.')
    if (p.valueType === 'ordinal') value = { type: 'ordinal', value: input.value }
    else {
      const n = normalizeQuantity(p, input.value, input.unitId ?? p.canonicalUnitId ?? '', registry)
      value = { type: 'quantity', value: n.value, unitId: n.unitId }; original = n.original
    }
  }
  const context = cleanContext(input.context)
  const record: Observation = {
    id: input.id, subjectId: input.subjectId, parameterId: p.id, parameterVersion: p.version, value,
    effectiveAt: input.effectiveAt, recordedAt: input.recordedAt, sourceId: input.sourceId, method: input.method,
    origin: input.origin, quality: input.quality ?? (input.value === null ? 'missing' : 'valid'),
    ...(original ? { original } : {}), ...(context ? { context } : {}), demonstrationOnly: input.demonstrationOnly ?? input.origin === 'synthetic',
  }
  return validateObservation(record, registry)
}

export function createWaveformObservation(input: Omit<ObservationInput, 'value' | 'unitId'> & { samples: number[]; sampleRateHz: number; unitId: string }, registry: Registry): Observation {
  const p = registry.parameter(input.parameterId)
  if (!p || p.valueType !== 'waveform') throw new Error(`'${input.parameterId}' is not a waveform parameter.`)
  const context = cleanContext(input.context)
  return validateObservation({
    id: input.id, subjectId: input.subjectId, parameterId: p.id, parameterVersion: p.version,
    value: { type: 'waveform', unitId: input.unitId, sampleRateHz: input.sampleRateHz, samples: input.samples },
    effectiveAt: input.effectiveAt, recordedAt: input.recordedAt, sourceId: input.sourceId, method: input.method,
    origin: input.origin, quality: input.quality ?? 'valid', ...(context ? { context } : {}), demonstrationOnly: input.demonstrationOnly ?? input.origin === 'synthetic',
  }, registry)
}

export function validateObservation(input: unknown, registry: Registry): Observation {
  const record = observationSchema.parse(input) as Observation
  const problems = checkObservation(record, registry)
  if (problems.length) throw new Error(problems.join(' '))
  return record
}

function cleanContext(c?: ObservationContext): ObservationContext | undefined {
  if (!c) return undefined
  const out: ObservationContext = {}
  for (const [k, v] of Object.entries(c) as [keyof ObservationContext, string | undefined][]) if (v?.trim()) out[k] = v.trim()
  return Object.keys(out).length ? out : undefined
}

/** Numeric value usable for trends: quantity or ordinal, with usable quality. Waveforms return null. */
export function numericValue(o: Observation): number | null {
  if (!o.value || o.quality === 'missing' || o.quality === 'invalid') return null
  return o.value.type === 'waveform' ? null : o.value.value
}

/** Display string for a value; never renders a missing reading as zero. */
export function formatValue(o: Observation, registry: Registry): string {
  if (!o.value || o.quality === 'missing') return 'No data'
  if (o.value.type === 'waveform') return `${o.value.samples.length} samples @ ${o.value.sampleRateHz} Hz`
  const p = registry.parameter(o.parameterId)
  if (o.value.type === 'ordinal') return `${o.value.value}${p?.scale ? ` / ${p.scale.max}` : ''}`
  return `${round(o.value.value)} ${registry.unit(o.value.unitId)?.symbol ?? o.value.unitId}`
}

export function round(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}
