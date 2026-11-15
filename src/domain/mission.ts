import type { ActorRole, AstronautId, GroundMessage, InventoryItem, MissionProfile, QualificationId, ResourceLot, ResourceUse } from '../../contracts/types'

/**
 * Mission configuration, communications and medical resources (v3.1).
 *
 * Presets describe mission CONTEXT from public sources (communication delay, resupply). They are
 * labelled with their basis. Level-of-care labels are descriptive placeholders until
 * NASA/TM-2017-219290 is reviewed. Inventory content is demonstration data.
 */

const DAY = 86_400_000

export const QUALIFICATIONS: { id: QualificationId; label: string }[] = [
  { id: 'crew_medical_officer', label: 'Crew Medical Officer' },
  { id: 'physician_level', label: 'Physician-level training' },
  { id: 'basic_life_support', label: 'Basic life support' },
]

export const MISSION_PRESETS: MissionProfile[] = [
  { id: 'leo-iss', name: 'LEO station (ISS-like)', destination: 'Low Earth orbit', durationDays: 180, comms: { mode: 'realtime', oneWayDelayMinutes: 0 }, evacuationAvailable: true, resupplyAvailable: true, levelOfCareLabel: 'ISS-class (label only; see NASA/TM-2017-219290, not yet reviewed)', qualifications: [], basis: 'ISS practice: ground flight surgeon with private medical conferences; onboard CMO (Russell 2023; JAXA).', sourceRefIds: ['russell-2023', 'jaxa-health'] },
  { id: 'lunar', name: 'Lunar surface / Gateway', destination: 'Moon', durationDays: 30, comms: { mode: 'delayed', oneWayDelayMinutes: 0.02 }, evacuationAvailable: true, resupplyAvailable: false, levelOfCareLabel: 'To be assigned (NASA/TM-2017-219290 not yet reviewed)', qualifications: [], basis: 'Light-time Earth–Moon ≈1.3 s one way (physical fact); evacuation takes days. Duration is a demonstration setting.', sourceRefIds: ['hrp-hazards'] },
  { id: 'mars-transit', name: 'Mars transit / surface', destination: 'Mars', durationDays: 790, comms: { mode: 'delayed', oneWayDelayMinutes: 20 }, evacuationAvailable: false, resupplyAvailable: false, levelOfCareLabel: 'Earth-independent (EIMO); label only', qualifications: [], basis: 'One-way delay up to about 20 min, no resupply (NASA HRP). Duration ≈ 26-month reference mission (Russell 2023).', sourceRefIds: ['hrp-hazards', 'russell-2023', 'iws-2025-eimo'] },
]

export function withCrewQualifications(m: MissionProfile, crew: { id: AstronautId; qualifications: QualificationId[] }[]): MissionProfile {
  return { ...m, qualifications: crew.map(c => ({ crewId: c.id, qualifications: [...new Set(c.qualifications)] })) }
}

export function crewWith(m: MissionProfile, q: QualificationId): AstronautId[] {
  return m.qualifications.filter(c => c.qualifications.includes(q)).map(c => c.crewId)
}

/** Store-and-forward message to the ground. Delivery time follows the mission's one-way delay; blackout queues it. */
export function composeGroundMessage(m: MissionProfile, input: { id: string; subjectId: AstronautId; encounterId?: string; at: string; byRole: ActorRole; summary: string; recordIds: string[] }): GroundMessage {
  if (input.byRole === 'system') throw new Error('Messages to the ground are sent by people.')
  if (!input.summary.trim()) throw new Error('Write a summary for the ground team.')
  const delayMs = m.comms.mode === 'realtime' ? 0 : m.comms.oneWayDelayMinutes * 60_000
  return { id: input.id, subjectId: input.subjectId, ...(input.encounterId ? { encounterId: input.encounterId } : {}), createdAt: input.at, byRole: input.byRole, summary: input.summary.trim(), recordIds: [...new Set(input.recordIds)], channel: 'store_and_forward', deliverAt: m.comms.mode === 'blackout' ? '9999-12-31T00:00:00.000Z' : new Date(Date.parse(input.at) + delayMs).toISOString() }
}

export function messageState(msg: GroundMessage, now: string): 'queued' | 'in_transit' | 'delivered' {
  if (msg.deliverAt.startsWith('9999')) return 'queued'
  return now >= msg.deliverAt ? 'delivered' : 'in_transit'
}

/** Earliest possible ground reply: two one-way delays. Null when no link. */
export function roundTripMinutes(m: MissionProfile): number | null {
  return m.comms.mode === 'blackout' ? null : m.comms.mode === 'realtime' ? 0 : m.comms.oneWayDelayMinutes * 2
}

// ── Resources ──

const usable = (l: ResourceLot, now: string) => l.quantity > 0 && (l.expiresAt === null || l.expiresAt > now)

export function availableQuantity(r: InventoryItem, now: string): number {
  return r.status === 'available' ? r.lots.filter(l => usable(l, now)).reduce((a, l) => a + l.quantity, 0) : 0
}
export function expiredQuantity(r: InventoryItem, now: string): number {
  return r.lots.filter(l => l.quantity > 0 && l.expiresAt !== null && l.expiresAt <= now).reduce((a, l) => a + l.quantity, 0)
}

export interface ResourceForecast { resourceId: string; available: number; expiringBeforeMissionEnd: number; firstExpiry: string | null; status: 'ok' | 'expires_in_mission' | 'unavailable' | 'empty' }
/** Which stock will still be in date at mission end. A logistics view; it says nothing about clinical need. */
export function forecast(r: InventoryItem, now: string, missionEnd: string): ResourceForecast {
  const avail = availableQuantity(r, now)
  const lots = r.status === 'available' ? r.lots.filter(l => usable(l, now)) : []
  const expiring = lots.filter(l => l.expiresAt !== null && l.expiresAt <= missionEnd)
  const firstExpiry = lots.map(l => l.expiresAt).filter((x): x is string => x !== null).sort()[0] ?? null
  return { resourceId: r.id, available: avail, expiringBeforeMissionEnd: expiring.reduce((a, l) => a + l.quantity, 0), firstExpiry, status: r.status !== 'available' ? 'unavailable' : avail === 0 ? 'empty' : expiring.length ? 'expires_in_mission' : 'ok' }
}

export function missionEnd(startAt: string, m: MissionProfile): string { return new Date(Date.parse(startAt) + m.durationDays * DAY).toISOString() }

/** Records use from the first-expiring usable lot(s) (FEFO). Returns the updated resource and use records. */
export function useResource(r: InventoryItem, input: { quantity: number; at: string; byRole: ActorRole; subjectId: AstronautId; encounterId?: string; interventionId?: string; newId: () => string }): { resource: InventoryItem; uses: ResourceUse[] } {
  if (input.byRole !== 'medical') throw new Error('Medical resources are used and logged in the Crew Medical Officer context.')
  if (!(input.quantity > 0)) throw new Error('Quantity must be positive.')
  if (availableQuantity(r, input.at) < input.quantity) throw new Error(`Not enough in-date ${r.name} available.`)
  let left = input.quantity
  const order = [...r.lots].filter(l => usable(l, input.at)).sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))
  const take = new Map<string, number>()
  for (const l of order) { if (!left) break; const n = Math.min(l.quantity, left); take.set(l.lotId, n); left -= n }
  const uses: ResourceUse[] = [...take.entries()].map(([lotId, quantity]) => ({ id: input.newId(), resourceId: r.id, lotId, quantity, at: input.at, byRole: input.byRole, subjectId: input.subjectId, ...(input.encounterId ? { encounterId: input.encounterId } : {}), ...(input.interventionId ? { interventionId: input.interventionId } : {}) }))
  return { resource: { ...r, lots: r.lots.map(l => take.has(l.lotId) ? { ...l, quantity: l.quantity - take.get(l.lotId)! } : l) }, uses }
}

/** Resources providing every requested capability tag that are currently usable. */
export function resourcesFor(tags: readonly string[], resources: readonly InventoryItem[], now: string): { tag: string; resources: InventoryItem[] }[] {
  return tags.map(tag => ({ tag, resources: resources.filter(r => r.capabilityTags.includes(tag) && availableQuantity(r, now) > 0) }))
}

/**
 * Demonstration inventory. Generic categories only — no drug names, strengths or doses — because
 * AEGIS must not imply a formulary. Quantities and dates are synthetic.
 */
export function demonstrationInventory(startAt: string): InventoryItem[] {
  const d = (days: number) => new Date(Date.parse(startAt) + days * DAY).toISOString()
  const r = (x: Omit<InventoryItem, 'demonstrationOnly' | 'status'> & { status?: InventoryItem['status'] }): InventoryItem => ({ status: 'available', demonstrationOnly: true, ...x })
  return [
    r({ id: 'res-bp-cuff', name: 'Blood pressure monitor', category: 'equipment', unit: 'device', location: 'Medical kit A', capabilityTags: ['blood_pressure'], lots: [{ lotId: 'BP-1', quantity: 1, expiresAt: null }] }),
    r({ id: 'res-oximeter', name: 'Pulse oximeter', category: 'equipment', unit: 'device', location: 'Medical kit A', capabilityTags: ['spo2', 'pulse_rate'], lots: [{ lotId: 'OX-1', quantity: 1, expiresAt: null }] }),
    r({ id: 'res-ecg', name: 'ECG monitor', category: 'diagnostic', unit: 'device', location: 'Medical kit B', capabilityTags: ['ecg_monitor'], lots: [{ lotId: 'ECG-1', quantity: 1, expiresAt: null }], status: 'maintenance', note: 'Demonstration: shown under maintenance to exercise availability checks.' }),
    r({ id: 'res-ultrasound', name: 'Ultrasound unit', category: 'diagnostic', unit: 'device', location: 'Medical bay', capabilityTags: ['imaging'], lots: [{ lotId: 'US-1', quantity: 1, expiresAt: null }] }),
    r({ id: 'res-thermometer', name: 'Thermometer', category: 'equipment', unit: 'device', location: 'Medical kit A', capabilityTags: ['temperature'], lots: [{ lotId: 'TH-1', quantity: 1, expiresAt: null }] }),
    r({ id: 'res-electrodes', name: 'ECG electrodes', category: 'consumable', unit: 'set', location: 'Medical kit B', capabilityTags: ['ecg_electrodes'], lots: [{ lotId: 'EL-A', quantity: 6, expiresAt: d(120) }, { lotId: 'EL-B', quantity: 20, expiresAt: d(900) }] }),
    r({ id: 'res-dressings', name: 'Wound dressings', category: 'consumable', unit: 'pack', location: 'Medical kit A', capabilityTags: ['wound_care'], lots: [{ lotId: 'DR-1', quantity: 12, expiresAt: d(400) }] }),
    r({ id: 'res-analgesic', name: 'Analgesic (category placeholder)', category: 'medication', unit: 'unit', location: 'Pharmacy drawer 1', capabilityTags: ['medication_placeholder'], lots: [{ lotId: 'AN-1', quantity: 30, expiresAt: d(-5) }, { lotId: 'AN-2', quantity: 40, expiresAt: d(300) }], note: 'Placeholder category; no product, strength or dose is represented. One lot is expired on purpose.' }),
    r({ id: 'res-oral-rehydration', name: 'Oral rehydration (category placeholder)', category: 'medication', unit: 'sachet', location: 'Pharmacy drawer 2', capabilityTags: ['hydration_support'], lots: [{ lotId: 'OR-1', quantity: 10, expiresAt: d(200) }] }),
  ]
}
