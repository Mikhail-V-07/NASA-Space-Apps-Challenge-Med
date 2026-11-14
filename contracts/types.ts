/** AEGIS canonical integration contracts v1.0 (hackathon prototype).
 *  Changes require integrator review. Do not duplicate types per feature module.
 */

export type ISODateTime = string;
export type AstronautId = string;
export type CompartmentId = string;
export type ObservationId = string;
export type ScenarioId = 'normal-day' | 'sleep-disruption' | 'co2-excursion' | 'radiation-event';

/** Separates provenance, which is not the same thing as acquisition method. */
export type DataOrigin = 'synthetic' | 'observed' | 'research_dataset';
export type AcquisitionMethod = 'simulator' | 'manual' | 'wearable' | 'environment_sensor' | 'camera_pose' | 'dataset_import' | 'assessment';
export type ObservationQuality = 'valid' | 'estimated' | 'missing' | 'invalid';

export type MetricKey =
  | 'heart_rate'                // bpm
  | 'resting_heart_rate'        // bpm
  | 'blood_pressure_systolic'  // mmHg
  | 'blood_pressure_diastolic' // mmHg
  | 'sleep_duration'            // h
  | 'reported_stress'           // scale with defined questionnaire
  | 'reported_fatigue'          // scale with defined questionnaire
  | 'exercise_duration'         // min
  | 'exercise_repetitions'      // count
  | 'cabin_co2'                 // ppm
  | 'cabin_temperature'         // °C
  | 'cabin_pressure'            // kPa
  | 'radiation_dose'            // unit specified in record; no unsupported predictions
  | 'reported_mood'
  | 'symptom_severity'
  | 'bone_mineral_density'
  | 'movement_range'
  | 'visual_fatigue'
  | 'other';

export interface SourceReference {
  id: string;
  title: string;
  url?: string;
  /** Examples: NASA HRP research, NASA OSDR study ID, simulated fixture. */
  kind: 'research' | 'dataset' | 'synthetic_fixture' | 'user_entry' | 'device';
  note?: string;
}

export interface HealthMeasurement {
  id: ObservationId;
  astronautId: AstronautId;
  metric: MetricKey;
  /** Missing values must be encoded with quality='missing' and value=null, NEVER 0. */
  value: number | null;
  unit: string;
  timestamp: ISODateTime;
  source: AcquisitionMethod;
  origin: DataOrigin;
  quality: ObservationQuality;
  compartmentId?: CompartmentId;
  sourceRefId?: string;
  /** Explicitly identifies arbitrary demonstration thresholds/fixtures. */
  demonstrationOnly?: boolean;
  /** Additional context, never a diagnosis. Symptom name or examination site. */
  note?: string;
}

export interface EnvironmentalMeasurement {
  id: ObservationId;
  compartmentId: CompartmentId;
  metric: 'cabin_co2' | 'cabin_temperature' | 'cabin_pressure' | 'radiation_dose' | 'other';
  value: number | null;
  unit: string;
  timestamp: ISODateTime;
  source: 'simulator' | 'environment_sensor' | 'dataset_import';
  origin: DataOrigin;
  quality: ObservationQuality;
  sourceRefId?: string;
  demonstrationOnly?: boolean;
}

export interface CrewMember {
  id: AstronautId;
  displayName: string;
  role: string;
  /** A baseline is a descriptive user-specific comparison, NOT a diagnosis. */
  baselines: Partial<Record<MetricKey, number>>;
  currentCompartmentId: CompartmentId;
  syntheticIdentity: boolean;
}

export interface Compartment {
  id: CompartmentId;
  label: string;
  category: 'living' | 'exercise' | 'medical' | 'work' | 'life_support' | 'shelter';
}

export interface ActivityRecord {
  id: string;
  astronautId: AstronautId;
  kind: 'exercise' | 'sleep' | 'work' | 'rest' | 'self_report' | 'medical_check';
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  source: AcquisitionMethod;
  origin: DataOrigin;
  quality: ObservationQuality;
  details?: Record<string, number | string | boolean | null>;
}

export interface AlertEvidence {
  observationId: string;
  explanation: string;
}

export interface HealthAlert {
  id: string;
  astronautId?: AstronautId;
  compartmentId?: CompartmentId;
  createdAt: ISODateTime;
  level: 'information' | 'attention' | 'review';
  title: string;
  explanation: string;
  evidence: AlertEvidence[];
  safeNextStep: string;
  status: 'new' | 'acknowledged';
  ruleId: string;
  /** For unvalidated demo rules, this MUST be true. */
  demonstrationOnly: boolean;
  sourceRefIds?: string[];
}

export interface MissionEvent {
  id: string;
  at: ISODateTime;
  kind: 'crew_movement' | 'routine' | 'measurement' | 'environment_incident' | 'radiation_incident' | 'health_alert' | 'operator_action';
  astronautId?: AstronautId;
  compartmentId?: CompartmentId;
  summary: string;
  scenarioId?: ScenarioId;
  synthetic: boolean;
}

export interface MissionState {
  missionTime: ISODateTime;
  /** Simulation can be paused; speed is the count of virtual seconds per real second. */
  paused: boolean;
  speed: number;
  activeScenario: ScenarioId;
  seed: number;
  crew: CrewMember[];
  compartments: Compartment[];
  measurements: HealthMeasurement[];
  environment: EnvironmentalMeasurement[];
  activities: ActivityRecord[];
  alerts: HealthAlert[];
  events: MissionEvent[];
  /** v2 additions are optional for compatibility with v1 consumers. */
  assessments?: AssessmentResult[];
  encounters?: MedicalEncounter[];
  sources?: SourceReference[];
  resources?: MedicalResource[];
}

export interface SimulationPort {
  initialState(seed?: number): MissionState;
  step(state: MissionState, virtualSeconds: number): MissionState;
  runScenario(state: MissionState, id: ScenarioId): MissionState;
  reset(seed?: number): MissionState;
}

export interface HealthEvaluatorPort {
  evaluate(state: MissionState): HealthAlert[];
}

export interface VisionPort {
  start(): Promise<void>;
  stop(): void;
  /** Output observations; must not record video by default. */
  onActivityRecord(callback: (activity: ActivityRecord) => void): () => void;
}

/** v2 provenance shared by assessment, encounter and follow-up records. */
export interface RecordMetadata {
  id: string;
  astronautId: AstronautId;
  timestamp: ISODateTime;
  source: AcquisitionMethod;
  origin: DataOrigin;
  quality: ObservationQuality;
  unit: string;
  sourceRefIds: string[];
  demonstrationOnly: boolean;
}

export interface TypingMetrics {
  durationMs: number;
  typedCharacters: number;
  correctCharacters: number;
  errors: number;
  corrections: number;
  interKeyMs: number[];
  wpm: number;
  accuracy: number;
}

export interface ReactionTrial {
  waitMs: number;
  responseMs: number | null;
  outcome: 'response' | 'missed' | 'premature';
}

export interface ReactionMetrics {
  durationMs: number;
  mode: 'demo' | 'extended';
  trials: ReactionTrial[];
  meanMs: number | null;
  medianMs: number | null;
  missed: number;
  premature: number;
}

export interface ProcedureAttempt {
  field: string;
  unit: string;
  expected: number;
  entered: number;
  matched: boolean;
  elapsedMs: number;
}

export type AssessmentResult = RecordMetadata & (
  | { kind: 'typing'; result: TypingMetrics }
  | { kind: 'reaction'; result: ReactionMetrics }
  | { kind: 'procedure'; result: { attempts: ProcedureAttempt[]; completed: boolean } }
);

export interface ClinicalAction extends RecordMetadata {
  kind: 'review' | 'follow_up';
  note: string;
  observationIds: string[];
  completed: boolean;
}

export interface MedicalEncounter extends RecordMetadata {
  alertId: string;
  title: string;
  status: 'open' | 'under_review' | 'resolved';
  actions: ClinicalAction[];
  resolvedAt?: ISODateTime;
}

export interface MedicalResource {
  id: string;
  label: string;
  quantity: number | null;
  unit: string;
  origin: DataOrigin;
  quality: ObservationQuality;
  timestamp: ISODateTime;
  source: AcquisitionMethod;
  sourceRefIds: string[];
}

export interface ClinicalWorkspace {
  measurements: HealthMeasurement[];
  assessments: AssessmentResult[];
  alerts: HealthAlert[];
  encounters: MedicalEncounter[];
}

export interface MissionSnapshot extends MissionState {
  assessments: AssessmentResult[];
  encounters: MedicalEncounter[];
  sources: SourceReference[];
  resources: MedicalResource[];
}

export interface ResearchSource extends SourceReference {
  establishes: string;
  feature: string;
  limitation: string;
  access: 'full_text' | 'abstract' | 'metadata' | 'unavailable';
  providesData: boolean;
  checkedAt: string;
}

/* ───────────────────────── v3: data-driven health parameter model ─────────────────────────
 * See docs/v3/SYSTEM_DESIGN.md. Additive; v1/v2 types above remain valid.
 * Parameters are DATA (registry entries), not union members: adding a parameter must not
 * require a type or schema change. No clinical reference values ship with the registry.
 */

/** Exact, definitional unit conversion to the parameter's canonical unit: canonical = value × factor + offset. */
export interface UnitConversion { factor: number; offset: number }
export interface UnitDefinition {
  id: string
  symbol: string
  /** Physical dimension, e.g. 'frequency', 'pressure', 'volume'. Units only convert within one dimension. */
  dimension: string
  /** Conversion to the dimension's canonical unit. Only exact definitions are allowed (e.g. 1 L = 1000 mL). */
  toCanonical?: UnitConversion
  canonicalUnitId?: string
}

export type ParameterKind = 'raw_signal' | 'measurement' | 'derived' | 'self_report' | 'examination'
export type ParameterValueType = 'quantity' | 'ordinal' | 'waveform'
export type ParameterStatus = 'active' | 'provisional' | 'retired'

export interface ParameterCategory { id: string; label: string; order: number }

/** Constraints that reject malformed INPUT. They are never clinical reference ranges. */
export interface EntryConstraints {
  min?: number
  max?: number
  integer?: boolean
  /** 'definitional' = follows from the quantity itself (e.g. SpO₂ ≤ 100 %). */
  basis: 'definitional'
  note?: string
}

export interface OrdinalScale {
  min: number
  max: number
  lowAnchor: string
  highAnchor: string
  /** True only when a validated instrument is cited. All current scales are descriptive. */
  validatedInstrument: boolean
}

export interface ParameterDefinition {
  id: string
  /** Short code displayed to users, e.g. 'HR', 'RRI'. Must be unique. */
  code: string
  displayName: string
  categoryId: string
  kind: ParameterKind
  valueType: ParameterValueType
  /** null while the unit is still to be determined (status must then be 'provisional'). */
  canonicalUnitId: string | null
  acceptedUnitIds: string[]
  entry?: EntryConstraints
  scale?: OrdinalScale
  /** Data sources that MAY provide this parameter. Availability is a property of the source. */
  potentialSourceIds: string[]
  /** Ways this value can be captured. Raw signals are not manually entered. */
  manualEntry: boolean
  /** Parameters measured together (e.g. systolic/diastolic) share an entry group. */
  entryGroupId?: string
  /** Text that prevents confusion with similarly named parameters (HR vs PR, RRI vs RR). */
  disambiguation?: string
  /** For derived parameters: inputs and (once defined) the derivation method. */
  derivation?: { fromParameterIds: string[]; methodId: string | null }
  requiresNote?: boolean
  visualization: 'line' | 'waveform' | 'none'
  status: ParameterStatus
  description: string
  /** Where this definition came from (project list, earlier core, research source IDs). */
  provenance: string
  sourceRefIds: string[]
  version: number
}

export type DataSourceKind = 'device' | 'manual' | 'derived' | 'simulator' | 'import'
export interface DataSourceDefinition {
  id: string
  label: string
  kind: DataSourceKind
  /** 'not_connected' = a potential source with no integration yet. Nothing is claimed about real hardware. */
  availability: 'simulated' | 'manual' | 'not_connected'
  providesParameterIds: string[]
  note?: string
}

export type ObservationValue =
  | { type: 'quantity'; value: number; unitId: string }
  | { type: 'ordinal'; value: number }
  | { type: 'waveform'; unitId: string; sampleRateHz: number; samples: number[] }

export interface ObservationContext {
  encounterId?: string
  interventionId?: string
  compartmentId?: string
  /** Free-text condition, e.g. 'seated, after 5 min rest'. Never a diagnosis. */
  condition?: string
  note?: string
}

/** One value of one parameter for one subject at one time. Missing = value null + quality 'missing'. */
export interface Observation {
  id: string
  subjectId: AstronautId
  parameterId: string
  parameterVersion: number
  value: ObservationValue | null
  /** When the physiological state was measured. */
  effectiveAt: ISODateTime
  /** When the record entered AEGIS. */
  recordedAt: ISODateTime
  sourceId: string
  method: AcquisitionMethod
  origin: DataOrigin
  quality: ObservationQuality
  /** Unit and value as originally entered, when converted to the canonical unit. */
  original?: { value: number; unitId: string }
  derivedFrom?: { observationIds: string[]; methodId: string }
  context?: ObservationContext
  demonstrationOnly: boolean
}

/** A descriptive personal comparison point. Not a normal range, not a diagnosis. */
export interface Baseline {
  id: string
  subjectId: AstronautId
  parameterId: string
  unitId: string
  method: 'descriptive_median' | 'recorded_reference'
  value: number
  summary: { n: number; min: number; max: number }
  observationIds: string[]
  window: { from: ISODateTime; to: ISODateTime }
  establishedAt: ISODateTime
  establishedByRole: 'astronaut' | 'medical'
  status: 'proposed' | 'accepted' | 'superseded'
  note?: string
}

/** Reference values MUST cite an approved source. The registry ships with none. */
export interface ReferenceValue {
  id: string
  parameterId: string
  unitId: string
  low?: number
  high?: number
  applicability: string
  sourceRefId: string
  approvalStatus: 'approved' | 'illustrative'
}

/* ───────────── v3 care workflow: concern → encounter → intervention → follow-up ───────────── */

export type ActorRole = 'astronaut' | 'medical' | 'system'
export interface CareNote { id: string; at: ISODateTime; byRole: ActorRole; text: string }

export type EncounterStatus = 'open' | 'monitoring' | 'closed'
export interface CareEncounter {
  id: string
  subjectId: AstronautId
  origin: DataOrigin
  openedAt: ISODateTime
  openedByRole: ActorRole
  trigger: { type: 'self_report' | 'observation_review' | 'alert' | 'scheduled_review'; refIds: string[] }
  /** Concern in the subject's or caregiver's words. Not a diagnosis. */
  concern: string
  status: EncounterStatus
  observationIds: string[]
  notes: CareNote[]
  interventionIds: string[]
  closedAt?: ISODateTime
  closure?: string
  demonstrationOnly: boolean
}

export type InterventionKind = 'monitoring' | 'activity_adjustment' | 'countermeasure' | 'procedure' | 'medication' | 'escalation'
/** A RECORD of an action decided and performed by people. AEGIS does not prescribe. */
export interface Intervention {
  id: string
  encounterId: string
  subjectId: AstronautId
  origin: DataOrigin
  kind: InterventionKind
  description: string
  /** Protocol basis. 'illustrative' marks demonstration content that is not clinically approved. */
  protocol: { status: 'none' | 'illustrative' | 'approved'; reference?: string }
  recordedAt: ISODateTime
  recordedByRole: ActorRole
  followUp: { dueAt: ISODateTime; parameterIds: string[] } | null
  outcome?: {
    assessedAt: ISODateTime
    byRole: ActorRole
    result: 'improved' | 'unchanged' | 'worse' | 'not_assessable'
    note: string
    observationIds: string[]
  }
  demonstrationOnly: boolean
}

export interface AuditEntry { id: string; at: ISODateTime; role: ActorRole; action: string; recordIds: string[] }

export interface HealthWorkspace {
  schemaVersion: 3
  observations: Observation[]
  baselines: Baseline[]
  encounters: CareEncounter[]
  interventions: Intervention[]
  audit: AuditEntry[]
}
