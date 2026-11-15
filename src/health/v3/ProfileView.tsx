import { useState } from 'react'
import type { ProfileEntryKind } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { formatTimestamp } from '../../app/format'
import { QUALIFICATIONS, activeBaseline, adherence, baselineVersions, occurrenceStatus, registry, round } from '../../domain'
import type { HealthView } from './useHealthView'

const KINDS: { id: ProfileEntryKind; label: string; cmoOnly?: boolean }[] = [
  { id: 'history', label: 'Medical history' }, { id: 'allergy', label: 'Allergy (as reported)' }, { id: 'medication', label: 'Medication (as reported)' },
  { id: 'limitation', label: 'Limitation / restriction' }, { id: 'risk_factor', label: 'Risk factor', cmoOnly: true }, { id: 'preflight_result', label: 'Pre-flight result', cmoOnly: true },
]

/** Health profile: what is known about this person, plus how the loop has updated it (baselines, plans, closed encounters). */
export function ProfileView({ view }: { view: HealthView }) {
  const [kind, setKind] = useState<ProfileEntryKind>('history'), [text, setText] = useState('')
  const name = view.crew.find(c => c.id === view.subjectId)?.displayName ?? view.subjectId
  const quals = view.mission.qualifications.find(q => q.crewId === view.subjectId)?.qualifications ?? []
  const baselineParams = [...new Set(view.workspace.baselines.map(b => b.parameterId))]
  const closed = view.workspace.encounters.filter(e => e.status === 'closed')
  const from = new Date(Date.parse(view.now) - 7 * 86_400_000).toISOString()
  const adh = adherence(view.workspace.plans.filter(p => p.status === 'active').flatMap(p => occurrenceStatus(p, view.workspace.completions, view.workspace.observations, from, view.now)))
  return <div className="content-grid">
    <Panel title={`Health profile — ${name}`} eyebrow={view.synthetic ? 'Synthetic workspace' : 'Observed records'}>
      <dl className="metadata stats">
        <div><dt>Qualifications</dt><dd>{quals.length ? quals.map(q => QUALIFICATIONS.find(x => x.id === q)?.label).join(', ') : 'None recorded'}</dd></div>
        <div><dt>Records</dt><dd>{view.workspace.observations.length} observations · {view.workspace.encounters.length} encounters</dd></div>
        <div><dt>Preventive plan (7 days)</dt><dd>{adh.fraction === null ? 'No completed slots' : `${adh.done}/${adh.due} logged`}</dd></div>
      </dl>
      {(['history', 'allergy', 'medication', 'limitation', 'risk_factor', 'preflight_result'] as ProfileEntryKind[]).map(k => {
        const entries = view.workspace.profile.filter(p => p.kind === k)
        return entries.length ? <section key={k}><h3 className="eyebrow">{KINDS.find(x => x.id === k)?.label}</h3><ul className="plain-list">{entries.map(e => <li key={e.id} className={e.status === 'resolved' ? 'muted' : ''}>{e.text} <span className="muted">· {formatTimestamp(e.recordedAt)} · {e.byRole}{e.status === 'resolved' ? ' · resolved' : ''}{e.demonstrationOnly ? ' · synthetic' : ''}</span>{view.role === 'medical' && !view.readOnly && e.status === 'active' && <button className="button small" onClick={() => view.send({ type: 'profile/resolve', entryId: e.id })}>Resolve</button>}</li>)}</ul></section> : null
      })}
      {!view.readOnly && <form className="entry-form" onSubmit={e => { e.preventDefault(); view.send({ type: 'profile/add', subjectId: view.subjectId!, kind, text }); setText('') }}>
        <div className="control-row"><label className="field">Entry type<select value={kind} onChange={e => setKind(e.target.value as ProfileEntryKind)}>{KINDS.filter(k => view.role === 'medical' || !k.cmoOnly).map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
          <label className="field">Text<input value={text} maxLength={2000} onChange={e => setText(e.target.value)} /></label>
          <button className="button" disabled={!text.trim()}>Add</button></div>
      </form>}
      <p className="sample-note">Profile entries are recorded text. AEGIS does not derive risk or eligibility from them.</p>
    </Panel>
    <Panel title="Personal baselines" eyebrow="Updated by the monitoring loop">
      {baselineParams.length ? <ul className="plain-list">{baselineParams.map(pid => { const b = activeBaseline(view.workspace.baselines, view.subjectId ?? '', pid)!; const n = baselineVersions(view.workspace.baselines, view.subjectId ?? '', pid).length; return <li key={pid}><strong>{registry.parameter(pid)?.displayName}</strong>: {round(b.value)} {registry.parameter(pid)?.canonicalUnitId ?? ''} · v{b.version ?? 1} {b.status} · {n} version(s)</li> })}</ul> : <p className="empty-copy">No baselines yet. Propose one in Monitoring.</p>}
      <h3>Closed encounters</h3>
      {closed.length ? <ul className="plain-list">{closed.map(e => <li key={e.id}>{e.concern} <span className="muted">— {e.closure} ({e.closedAt && formatTimestamp(e.closedAt)})</span></li>)}</ul> : <p className="muted">None.</p>}
    </Panel>
  </div>
}
