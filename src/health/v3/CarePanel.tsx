import { useState } from 'react'
import type { CareEncounter, Intervention, InterventionKind } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { formatTimestamp } from '../../app/format'
import { followUpEvidence, followUpState, formatValue, registry, SELF_CARE_KINDS } from '../../domain'
import type { HealthView } from './useHealthView'

const KINDS: { id: InterventionKind; label: string }[] = [
  { id: 'monitoring', label: 'Monitoring / repeat measurement' }, { id: 'activity_adjustment', label: 'Activity or schedule adjustment' },
  { id: 'countermeasure', label: 'Countermeasure' }, { id: 'procedure', label: 'Procedure' }, { id: 'medication', label: 'Medication' }, { id: 'escalation', label: 'Escalation to ground medical support' },
]
const STATE_LABEL = { none: 'No follow-up', scheduled: 'Follow-up scheduled', due: 'Follow-up due', evidence_available: 'Follow-up readings available', assessed: 'Outcome recorded' } as const

/** Concern → encounter → recorded action → follow-up → outcome → closure. */
export function CarePanel({ view, selectedParameterId }: { view: HealthView; selectedParameterId: string }) {
  const { workspace, readOnly, role } = view
  const [open, setOpen] = useState<string | null>(null)
  const encounters = [...workspace.encounters].sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  const active = encounters.find(e => e.id === open) ?? encounters.find(e => e.status !== 'closed') ?? encounters[0]
  if (view.synthetic) return <Panel title="Care & follow-up" eyebrow="Synthetic preview"><p className="empty-copy">Care records are kept for observed data only. Scenario cases remain under Events & Alerts.</p></Panel>
  return <Panel title="Care & follow-up" eyebrow={role === 'medical' ? 'Crew Medical Officer context' : 'Your concerns and follow-up'}>
    {!readOnly && <ConcernForm view={view} selectedParameterId={selectedParameterId} onOpened={() => setOpen(null)} />}
    {encounters.length > 0 && <div className="chip-row" role="list" aria-label="Encounters">{encounters.map(e => <button key={e.id} role="listitem" className="crew-chip" aria-pressed={active?.id === e.id} onClick={() => setOpen(e.id)}>{e.status === 'closed' ? '✓ ' : ''}{e.concern.slice(0, 60)} · {e.status}</button>)}</div>}
    {active ? <EncounterDetail key={active.id} view={view} encounter={active} /> : <p className="empty-copy">No concerns recorded.</p>}
    <p className="sample-note">AEGIS records and structures what people decide. It does not diagnose, select treatments or close cases. Protocols marked illustrative are demonstration content, not clinically approved guidance.</p>
  </Panel>
}

function ConcernForm({ view, selectedParameterId, onOpened }: { view: HealthView; selectedParameterId: string; onOpened(): void }) {
  const [concern, setConcern] = useState(''), [attach, setAttach] = useState(true)
  const latest = [...view.workspace.observations].filter(o => o.parameterId === selectedParameterId).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt)).at(-1)
  const p = registry.parameter(selectedParameterId)
  return <form className="entry-form" onSubmit={e => { e.preventDefault(); if (!view.subjectId) return; view.send({ type: 'encounter/open', subjectId: view.subjectId, concern, trigger: { type: 'self_report', refIds: [] }, observationIds: attach && latest ? [latest.id] : [] }); setConcern(''); onOpened() }}>
    <label className="field">Describe a concern in your own words<textarea value={concern} maxLength={2000} onChange={e => setConcern(e.target.value)} placeholder="What you notice, since when, what makes it better or worse" /></label>
    {latest && p && <label className="check-label"><input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />Attach latest {p.code} reading ({formatValue(latest, registry)})</label>}
    <button className="button" type="submit" disabled={!concern.trim()}>Record concern</button>
  </form>
}

function EncounterDetail({ view, encounter: e }: { view: HealthView; encounter: CareEncounter }) {
  const { workspace, readOnly, role } = view
  const [note, setNote] = useState(''), [closure, setClosure] = useState('')
  const interventions = workspace.interventions.filter(i => i.encounterId === e.id)
  const evidence = workspace.observations.filter(o => e.observationIds.includes(o.id))
  const writable = !readOnly && e.status !== 'closed'
  return <article className="care-item" aria-label="Encounter">
    <header><span className="badge">{e.status}</span> <span className="muted">Opened {formatTimestamp(e.openedAt)} by {e.openedByRole}</span></header>
    <p className="care-concern">{e.concern}</p>
    {evidence.length > 0 && <ul className="plain-list">{evidence.map(o => <li key={o.id}>{registry.parameter(o.parameterId)?.code}: {formatValue(o, registry)} · {formatTimestamp(o.effectiveAt)}</li>)}</ul>}
    {e.notes.length > 0 && <ol className="plain-list">{e.notes.map(n => <li key={n.id}><span className="mono">{formatTimestamp(n.at)} · {n.byRole}</span> {n.text}</li>)}</ol>}
    {writable && <form className="control-row" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'encounter/note', encounterId: e.id, text: note }); setNote('') }}><label className="field">Add note<input value={note} maxLength={2000} onChange={ev => setNote(ev.target.value)} /></label><button className="button" disabled={!note.trim()}>Add</button></form>}
    {interventions.map(i => <InterventionItem key={i.id} view={view} intervention={i} />)}
    {writable && <InterventionForm view={view} encounter={e} />}
    {writable && role === 'medical' && <form className="control-row" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'encounter/close', encounterId: e.id, closure }) }}><label className="field">Closure summary (CMO)<input value={closure} maxLength={2000} onChange={ev => setClosure(ev.target.value)} /></label><button className="button" disabled={!closure.trim()}>Close encounter</button></form>}
    {e.status === 'closed' && <p className="sample-note">Closed {e.closedAt && formatTimestamp(e.closedAt)}: {e.closure}</p>}
  </article>
}

function InterventionForm({ view, encounter }: { view: HealthView; encounter: CareEncounter }) {
  const allowed = view.role === 'medical' ? KINDS : KINDS.filter(k => SELF_CARE_KINDS.includes(k.id))
  const [kind, setKind] = useState<InterventionKind>(allowed[0]!.id), [description, setDescription] = useState('')
  const [protocol, setProtocol] = useState<'none' | 'illustrative'>('none'), [reference, setReference] = useState('')
  const [due, setDue] = useState(''), [params, setParams] = useState<string[]>([])
  const recordable = registry.parameters.filter(p => p.status === 'active' && p.manualEntry)
  return <form className="entry-form follow-up" onSubmit={ev => {
    ev.preventDefault()
    view.send({ type: 'intervention/record', encounterId: encounter.id, input: { kind, description, protocol: { status: protocol, ...(reference.trim() ? { reference } : {}) }, followUp: due ? { dueAt: new Date(due).toISOString(), parameterIds: params } : null } })
    setDescription(''); setDue(''); setParams([])
  }}>
    <h3>Record an action taken</h3>
    <label className="field">Type<select value={kind} onChange={ev => setKind(ev.target.value as InterventionKind)}>{allowed.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
    {view.role === 'astronaut' && <p className="muted">Other action types are recorded in the Crew Medical Officer context.</p>}
    <label className="field">What was done<textarea value={description} maxLength={2000} onChange={ev => setDescription(ev.target.value)} /></label>
    <div className="control-row"><label className="field">Protocol basis<select value={protocol} onChange={ev => setProtocol(ev.target.value as 'none' | 'illustrative')}><option value="none">None</option><option value="illustrative">Illustrative (demonstration content)</option></select></label>
      <label className="field">Reference (optional)<input value={reference} maxLength={200} onChange={ev => setReference(ev.target.value)} /></label></div>
    <p className="muted">"Approved" is unavailable: no clinically approved protocol content is loaded onboard.</p>
    <label className="field">Follow-up due (optional)<input type="datetime-local" value={due} onChange={ev => setDue(ev.target.value)} /></label>
    {due && <fieldset className="field"><legend>Re-check parameters</legend><div className="chip-row">{recordable.map(p => <label key={p.id} className="check-label"><input type="checkbox" checked={params.includes(p.id)} onChange={ev => setParams(ev.target.checked ? [...params, p.id] : params.filter(x => x !== p.id))} />{p.code}</label>)}</div></fieldset>}
    <button className="button" type="submit" disabled={!description.trim() || Boolean(due && !params.length)}>Record action</button>
  </form>
}

function InterventionItem({ view, intervention: i }: { view: HealthView; intervention: Intervention }) {
  const now = new Date().toISOString(), state = followUpState(i, view.workspace.observations, now)
  const evidence = followUpEvidence(i, view.workspace.observations)
  const [result, setResult] = useState<NonNullable<Intervention['outcome']>['result']>('unchanged'), [note, setNote] = useState(''), [chosen, setChosen] = useState<string[]>([])
  return <div className="follow-up care-action">
    <p><span className="badge neutral">{i.kind.replace('_', ' ')}</span> {i.description}</p>
    <p className="muted">Recorded {formatTimestamp(i.recordedAt)} by {i.recordedByRole} · protocol: {i.protocol.status}{i.protocol.reference ? ` (${i.protocol.reference})` : ''}{i.demonstrationOnly ? ' · demonstration' : ''}</p>
    {i.followUp && <p className="muted"><strong>{STATE_LABEL[state]}</strong> · re-check {i.followUp.parameterIds.map(id => registry.parameter(id)?.code ?? id).join(', ')} by {formatTimestamp(i.followUp.dueAt)}</p>}
    {evidence.length > 0 && <ul className="plain-list">{evidence.map(o => <li key={o.id}>{registry.parameter(o.parameterId)?.code}: {formatValue(o, registry)} · {formatTimestamp(o.effectiveAt)}{!i.outcome && view.role === 'medical' && <label className="check-label inline"><input type="checkbox" checked={chosen.includes(o.id)} onChange={ev => setChosen(ev.target.checked ? [...chosen, o.id] : chosen.filter(x => x !== o.id))} />cite</label>}</li>)}</ul>}
    {i.outcome && <p className="sample-note">Outcome ({i.outcome.byRole}, {formatTimestamp(i.outcome.assessedAt)}): <strong>{i.outcome.result.replace('_', ' ')}</strong> — {i.outcome.note}</p>}
    {!i.outcome && i.followUp && view.role === 'medical' && !view.readOnly && <form className="control-row" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'intervention/outcome', interventionId: i.id, result, note, observationIds: chosen }) }}>
      <label className="field">Outcome (CMO judgement)<select value={result} onChange={ev => setResult(ev.target.value as typeof result)}><option value="improved">Improved</option><option value="unchanged">Unchanged</option><option value="worse">Worse</option><option value="not_assessable">Not assessable</option></select></label>
      <label className="field">Note<input value={note} maxLength={2000} onChange={ev => setNote(ev.target.value)} /></label>
      <button className="button" disabled={!note.trim()}>Record outcome</button>
    </form>}
  </div>
}
