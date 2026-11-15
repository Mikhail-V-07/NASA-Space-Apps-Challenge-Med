import { useState } from 'react'
import type { CareEncounter, DecisionRecord, EncounterPriority, ProtocolRun, SymptomEntry } from '../../../contracts/types'
import { formatTimestamp } from '../../app/format'
import { PROTOCOLS, availableQuantity, encounterSummary, messageState, protocolById, registry, roundTripMinutes, safetyCheck } from '../../domain'
import type { HealthView } from './useHealthView'

/** Clinical framework sections inside one encounter: priority, intake, exam, protocol, decisions, ground, resources. */
export function ClinicalSections({ view, encounter: e }: { view: HealthView; encounter: CareEncounter }) {
  const writable = !view.readOnly && e.status !== 'closed'
  const intakes = view.workspace.intakes.filter(i => i.encounterId === e.id)
  const findings = view.workspace.findings.filter(f => f.encounterId === e.id)
  const runs = view.workspace.protocolRuns.filter(r => r.encounterId === e.id)
  const decisions = view.workspace.decisions.filter(d => d.encounterId === e.id)
  const messages = view.workspace.messages.filter(m => m.encounterId === e.id)
  return <div className="stack clinical">
    <PriorityControl view={view} encounter={e} writable={writable} />
    <section aria-label="Intake"><h3>Symptoms & history</h3>
      {intakes.map(i => <div key={i.id} className="follow-up"><p className="mono muted">{formatTimestamp(i.at)} · {i.byRole}</p>
        <ul className="plain-list">{i.symptoms.map((s, k) => <li key={k}><strong>{s.label}</strong>{s.bodyRegion ? ` · ${s.bodyRegion}` : ''}{s.severity !== undefined ? ` · ${s.severity}/10 (self-rated)` : ''}{s.onsetAt ? ` · since ${formatTimestamp(s.onsetAt)}` : ''}{s.character ? ` · ${s.character}` : ''}{s.associated ? ` · with ${s.associated}` : ''}</li>)}</ul>
        {i.history && <p>History: {i.history}</p>}{i.medications && <p>Medications reported: {i.medications}</p>}{i.allergies && <p>Allergies reported: {i.allergies}</p>}
      </div>)}
      {writable && <IntakeForm view={view} encounterId={e.id} />}
    </section>
    <section aria-label="Examination"><h3>Examination</h3>
      {findings.length ? <ul className="plain-list">{findings.map(f => <li key={f.id}><span className="mono">{formatTimestamp(f.at)}</span> <strong>{f.area}:</strong> {f.finding}</li>)}</ul> : <p className="muted">No findings recorded.</p>}
      {writable && view.role === 'medical' && <FindingForm view={view} encounterId={e.id} />}
    </section>
    <section aria-label="Protocol"><h3>Guided workflow</h3>
      {runs.map(r => <ProtocolRunView key={r.id} view={view} run={r} encounter={e} writable={writable} />)}
      {writable && view.role === 'medical' && <div className="control-row">{PROTOCOLS.filter(p => !runs.some(r => r.protocolId === p.id && r.status === 'active')).map(p => <button key={p.id} className="button" onClick={() => view.send({ type: 'protocol/start', encounterId: e.id, protocolId: p.id })}>Start: {p.title}</button>)}</div>}
      {!runs.length && view.role !== 'medical' && <p className="muted">Workflows are run in the CMO context.</p>}
    </section>
    {decisions.length > 0 && <section aria-label="Decisions"><h3>Decisions on suggestions</h3><ul className="plain-list">{decisions.map(d => <li key={d.id}><span className="mono">{formatTimestamp(d.at)} · {d.byRole}</span> <strong>{d.decision}</strong>: “{d.recommendation.text}” ({d.recommendation.source.replace('_', ' ')}){d.rationale ? ` — ${d.rationale}` : ''}</li>)}</ul></section>}
    <GroundSection view={view} encounter={e} messages={messages} writable={writable} />
    {writable && view.role === 'medical' && <ResourceUseForm view={view} encounter={e} />}
  </div>
}

function PriorityControl({ view, encounter: e, writable }: { view: HealthView; encounter: CareEncounter; writable: boolean }) {
  const p = e.priority ?? 'routine'
  return <div className={`control-row priority priority-${p}`}>
    <span className={p === 'emergency' ? 'badge emergency' : 'badge neutral'}>Priority: {p}</span>
    {writable && (['routine', 'urgent', 'emergency'] as EncounterPriority[]).filter(x => x !== p && (view.role === 'medical' || x === 'emergency' || p !== 'emergency')).map(x => <button key={x} className={x === 'emergency' ? 'button danger' : 'button'} onClick={() => view.send({ type: 'encounter/priority', encounterId: e.id, priority: x })}>Set {x}</button>)}
    {p === 'emergency' && <span className="muted">Emergency mode: follow the mission’s approved emergency procedures; AEGIS coordinates and records only.</span>}
  </div>
}

function IntakeForm({ view, encounterId }: { view: HealthView; encounterId: string }) {
  const blank: SymptomEntry = { label: '' }
  const [symptoms, setSymptoms] = useState<SymptomEntry[]>([blank]), [history, setHistory] = useState(''), [meds, setMeds] = useState(''), [allergies, setAllergies] = useState('')
  const set = (k: number, patch: Partial<SymptomEntry>) => setSymptoms(symptoms.map((s, i) => i === k ? { ...s, ...patch } : s))
  return <form className="entry-form follow-up" onSubmit={ev => {
    ev.preventDefault()
    const clean = symptoms.filter(s => s.label.trim()).map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '' && v !== undefined && !(typeof v === 'number' && Number.isNaN(v)))) as unknown as SymptomEntry)
    view.send({ type: 'intake/record', encounterId, symptoms: clean, history, medications: meds, allergies }); setSymptoms([blank]); setHistory(''); setMeds(''); setAllergies('')
  }}>
    <h4>Structured intake</h4>
    {symptoms.map((s, k) => <div className="control-row" key={k}>
      <label className="field">Symptom<input value={s.label} maxLength={200} onChange={ev => set(k, { label: ev.target.value })} /></label>
      <label className="field">Where<input value={s.bodyRegion ?? ''} maxLength={200} onChange={ev => set(k, { bodyRegion: ev.target.value })} /></label>
      <label className="field">Since<input type="datetime-local" onChange={ev => set(k, ev.target.value ? { onsetAt: new Date(ev.target.value).toISOString() } : { onsetAt: '' })} /></label>
      <label className="field">Self-rated 0–10<input type="number" min={0} max={10} step={1} value={s.severity ?? ''} onChange={ev => set(k, ev.target.value === '' ? { severity: Number.NaN } : { severity: Number(ev.target.value) })} /></label>
      <label className="field">Character<input value={s.character ?? ''} maxLength={500} onChange={ev => set(k, { character: ev.target.value })} /></label>
    </div>)}
    <button type="button" className="button" onClick={() => setSymptoms([...symptoms, blank])}>Add another symptom</button>
    <label className="field">History of this concern<textarea value={history} maxLength={2000} onChange={ev => setHistory(ev.target.value)} /></label>
    <div className="control-row"><label className="field">Medications taken (as reported)<input value={meds} maxLength={2000} onChange={ev => setMeds(ev.target.value)} /></label><label className="field">Allergies (as reported)<input value={allergies} maxLength={2000} onChange={ev => setAllergies(ev.target.value)} /></label></div>
    <button className="button" type="submit">Save intake</button>
    <p className="sample-note">Recorded as reported. AEGIS does not interpret symptoms.</p>
  </form>
}

function FindingForm({ view, encounterId }: { view: HealthView; encounterId: string }) {
  const [area, setArea] = useState(''), [finding, setFinding] = useState('')
  return <form className="control-row" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'finding/record', encounterId, area, finding }); setArea(''); setFinding('') }}>
    <label className="field">Area / system<input value={area} maxLength={200} onChange={ev => setArea(ev.target.value)} /></label>
    <label className="field">Finding (as observed)<input value={finding} maxLength={2000} onChange={ev => setFinding(ev.target.value)} /></label>
    <button className="button" disabled={!area.trim() || !finding.trim()}>Record finding</button>
  </form>
}

function ProtocolRunView({ view, run, encounter, writable }: { view: HealthView; run: ProtocolRun; encounter: CareEncounter; writable: boolean }) {
  const p = protocolById(run.protocolId)
  const [note, setNote] = useState(''), [option, setOption] = useState('')
  if (!p) return <p className="form-error">Unknown protocol {run.protocolId}.</p>
  const step = p.steps.find(s => s.id === run.currentStepId)
  const check = step ? safetyCheck(p, step, { resources: view.workspace.resources, mission: view.mission, now: view.now, ws: view.workspace, encounter }) : null
  const decide = (decision: DecisionRecord['decision']) => step && view.send({ type: 'decision/record', encounterId: encounter.id, recommendation: { source: 'protocol_step', refId: `${p.id}:${step.id}`, text: step.title, evidenceIds: encounter.observationIds, limitations: ['Illustrative workflow step.'] }, decision, rationale: note })
  return <article className="follow-up protocol-run" aria-label={p.title}>
    <p><span className="badge demo">{run.protocolStatus}</span> <strong>{p.title}</strong> <span className="muted">v{run.protocolVersion} · {run.status} · started {formatTimestamp(run.startedAt)}</span></p>
    <p className="muted">{p.purpose}</p>
    <ol className="plain-list protocol-steps">{p.steps.map(s => { const rec = run.steps.find(x => x.stepId === s.id); return <li key={s.id} className={s.id === run.currentStepId ? 'current' : rec ? 'done' : ''}>
      <span className="mono">{rec ? (rec.status === 'done' ? '✓' : '–') : s.id === run.currentStepId ? '▶' : '·'}</span> {s.title}{rec?.optionId ? ` → ${s.options?.find(o => o.id === rec.optionId)?.label}` : ''}{rec?.note ? <span className="muted"> — {rec.note}</span> : null}{rec?.safetyIssues.length ? <span className="muted"> (issues acknowledged: {rec.safetyIssues.length})</span> : null}
    </li> })}</ol>
    {step && check && <div className="step-current">
      <p><strong>{step.title}</strong> <span className="muted">({step.kind})</span></p>
      <p>{step.guidance}</p>
      {step.parameterIds?.length ? <p className="muted">Record: {step.parameterIds.map(id => registry.parameter(id)?.code ?? id).join(', ')} — use Monitoring, then link readings to this encounter.</p> : null}
      {check.issues.length > 0 && <ul className="plain-list safety-issues" role="alert">{check.issues.map(i => <li key={i}>⚠ {i}</li>)}</ul>}
      {check.notes.map(n => <p key={n} className="sample-note">{n}</p>)}
      {writable && view.role === 'medical' && <form className="entry-form" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'protocol/advance', runId: run.id, status: 'done', observationIds: [], safetyIssues: check.issues, ...(option ? { optionId: option } : {}), ...(note ? { note } : {}) }); setNote(''); setOption('') }}>
        {step.options && <label className="field">Choice<select value={option} onChange={ev => setOption(ev.target.value)}><option value="">Choose…</option>{step.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
        <label className="field">Note{check.issues.length ? ' (required: acknowledge the issues)' : ''}<input value={note} maxLength={2000} onChange={ev => setNote(ev.target.value)} /></label>
        <div className="control-row">
          <button className="button primary" type="submit" disabled={(Boolean(step.options) && !option) || (check.issues.length > 0 && !note.trim())}>Complete step</button>
          <button type="button" className="button" disabled={!note.trim()} onClick={() => { view.send({ type: 'protocol/advance', runId: run.id, status: 'skipped', observationIds: [], safetyIssues: check.issues, note }); setNote('') }}>Skip with reason</button>
          {step.kind === 'decide' && <><button type="button" className="button" onClick={() => decide('accepted')}>Record: accept suggestion</button><button type="button" className="button" disabled={!note.trim()} onClick={() => decide('declined')}>Record: decline (reason in note)</button></>}
        </div>
      </form>}
    </div>}
    <p className="sample-note">Illustrative workflow: structure and timing only. It contains no diagnostic criteria, drugs or doses. Safety checks surface issues; the CMO decides.</p>
  </article>
}

function GroundSection({ view, encounter: e, messages, writable }: { view: HealthView; encounter: CareEncounter; messages: HealthView['workspace']['messages']; writable: boolean }) {
  const [summary, setSummary] = useState('')
  const rt = roundTripMinutes(view.mission)
  const draft = () => encounterSummary(e, view.workspace, id => registry.parameter(id)?.code ?? id)
  return <section aria-label="Ground communication"><h3>Ground medical team</h3>
    <p className="muted">{view.mission.name}: {view.mission.comms.mode}{rt ? `, earliest reply ≈ ${Math.round(rt)} min after sending` : rt === 0 ? ', real-time link' : ''}. Messages are store-and-forward.</p>
    {messages.length > 0 && <ul className="plain-list">{messages.map(m => <li key={m.id}><span className="badge neutral">{messageState(m, view.now).replace('_', ' ')}</span> {formatTimestamp(m.createdAt)} → deliver {m.deliverAt.startsWith('9999') ? 'when link returns' : formatTimestamp(m.deliverAt)}<pre className="message-body">{m.summary}</pre></li>)}</ul>}
    {writable && <form className="entry-form" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'message/send', subjectId: e.subjectId, encounterId: e.id, summary, recordIds: [e.id, ...e.observationIds] }); setSummary('') }}>
      <label className="field">Summary for the ground<textarea value={summary} maxLength={4000} onChange={ev => setSummary(ev.target.value)} /></label>
      <div className="control-row"><button type="button" className="button" onClick={() => setSummary(draft())}>Draft from encounter</button><button className="button" disabled={!summary.trim()}>Queue message</button></div>
    </form>}
    <p className="sample-note">Local prototype: messages are recorded and timed, not transmitted. Real transmission must be private and encrypted (NASA-STD-3001 V1 3004).</p>
  </section>
}

function ResourceUseForm({ view, encounter: e }: { view: HealthView; encounter: CareEncounter }) {
  const usable = view.workspace.resources.filter(r => r.category !== 'equipment' && availableQuantity(r, view.now) > 0)
  const [id, setId] = useState(''), [qty, setQty] = useState('1'), [interventionId, setInterventionId] = useState('')
  const ints = view.workspace.interventions.filter(i => i.encounterId === e.id)
  if (!usable.length) return null
  return <section aria-label="Resource use"><h3>Log resource use</h3>
    <form className="control-row" onSubmit={ev => { ev.preventDefault(); view.send({ type: 'resource/use', resourceId: id, quantity: Number(qty), subjectId: e.subjectId, encounterId: e.id, ...(interventionId ? { interventionId } : {}) }) }}>
      <label className="field">Item<select value={id} onChange={ev => setId(ev.target.value)}><option value="">Choose…</option>{usable.map(r => <option key={r.id} value={r.id}>{r.name} ({availableQuantity(r, view.now)} {r.unit} in date)</option>)}</select></label>
      <label className="field">Quantity<input type="number" min={1} value={qty} onChange={ev => setQty(ev.target.value)} /></label>
      {ints.length > 0 && <label className="field">For action<select value={interventionId} onChange={ev => setInterventionId(ev.target.value)}><option value="">—</option>{ints.map(i => <option key={i.id} value={i.id}>{i.description.slice(0, 50)}</option>)}</select></label>}
      <button className="button" disabled={!id}>Log use</button>
    </form>
    <p className="sample-note">First-expiring in-date lot is used first. Logging use is inventory bookkeeping, not a treatment record.</p>
  </section>
}
