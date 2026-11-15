import { useState } from 'react'
import type { QualificationId } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { useAppState } from '../../app/state/context'
import { formatTimestamp } from '../../app/format'
import { MISSION_PRESETS, QUALIFICATIONS, demonstrationInventory, expiredQuantity, forecast, missionEnd, roundTripMinutes, sourceRef } from '../../domain'
import type { HealthView } from './useHealthView'

export function MissionResourcesView({ view }: { view: HealthView }) {
  const { state, dispatch } = useAppState()
  const m = view.mission
  const end = missionEnd(state.missionConfig.startAt, m)
  const [quals, setQuals] = useState(state.missionConfig.qualifications)
  const editable = view.role === 'medical'
  const rt = roundTripMinutes(m)
  const toggle = (crewId: string, q: QualificationId) => setQuals(quals.map(c => c.crewId !== crewId ? c : { ...c, qualifications: c.qualifications.includes(q) ? c.qualifications.filter(x => x !== q) : [...c.qualifications, q] }))
  return <div className="stack">
    <Panel title="Mission configuration" eyebrow={m.name}>
      <dl className="metadata stats">
        <div><dt>Destination</dt><dd>{m.destination} · {m.durationDays} days (ends {end.slice(0, 10)})</dd></div>
        <div><dt>Communications</dt><dd>{m.comms.mode}{m.comms.mode === 'delayed' ? ` · one-way ≈ ${m.comms.oneWayDelayMinutes < 1 ? `${Math.round(m.comms.oneWayDelayMinutes * 60)} s` : `${m.comms.oneWayDelayMinutes} min`}` : ''}{rt ? ` · round trip ≥ ${Math.round(rt)} min` : ''}</dd></div>
        <div><dt>Evacuation / resupply</dt><dd>{m.evacuationAvailable ? 'Evacuation possible' : 'No evacuation'} · {m.resupplyAvailable ? 'resupply' : 'no resupply'}</dd></div>
        <div><dt>Level of care</dt><dd>{m.levelOfCareLabel}</dd></div>
      </dl>
      <p className="sample-note">Basis: {m.basis} Sources: {m.sourceRefIds.map(id => sourceRef(id)?.title ?? id).join('; ')}.</p>
      {editable && <div className="entry-form">
        <label className="field">Mission profile<select value={state.missionConfig.profileId} onChange={e => dispatch({ type: 'mission/configure', profileId: e.target.value, qualifications: quals })}>{MISSION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="table-wrap"><table><caption>Crew qualifications (used by workflow safety checks)</caption>
          <thead><tr><th>Crew</th>{QUALIFICATIONS.map(q => <th key={q.id}>{q.label}</th>)}</tr></thead>
          <tbody>{state.mission.crew.map(c => <tr key={c.id}><td>{c.displayName}</td>{QUALIFICATIONS.map(q => <td key={q.id}><input type="checkbox" aria-label={`${c.displayName} ${q.label}`} checked={quals.find(x => x.crewId === c.id)?.qualifications.includes(q.id) ?? false} onChange={() => toggle(c.id, q.id)} /></td>)}</tr>)}</tbody>
        </table></div>
        <button className="button" onClick={() => dispatch({ type: 'mission/configure', profileId: state.missionConfig.profileId, qualifications: quals })}>Save qualifications</button>
      </div>}
    </Panel>
    <Panel title="Medical inventory" eyebrow={`${view.workspace.resources.length} item(s) · forecast to mission end`}>
      {view.workspace.resources.length ? <div className="table-wrap"><table><caption>Inventory with expiry</caption>
        <thead><tr><th>Item</th><th>Status</th><th>In date</th><th>Expired</th><th>Expiring before mission end</th><th>First expiry</th><th>Location</th></tr></thead>
        <tbody>{view.workspace.resources.map(r => { const f = forecast(r, view.now, end); return <tr key={r.id}>
          <td>{r.name} <span className="muted">({r.category}{r.demonstrationOnly ? ', demonstration' : ''})</span>{r.note && <><br /><span className="muted">{r.note}</span></>}</td>
          <td><span className={f.status === 'ok' ? 'badge neutral' : 'badge'}>{f.status.replaceAll('_', ' ')}</span></td>
          <td>{f.available} {r.unit}</td><td>{expiredQuantity(r, view.now) || '—'}</td><td>{f.expiringBeforeMissionEnd || '—'}</td><td>{f.firstExpiry ? formatTimestamp(f.firstExpiry) : 'none'}</td><td>{r.location}</td>
        </tr> })}</tbody>
      </table></div> : <p className="empty-copy">No inventory recorded.</p>}
      {editable && !view.readOnly && !view.workspace.resources.length && <button className="button" onClick={() => view.send({ type: 'resources/seed', resources: demonstrationInventory(state.missionConfig.startAt) })}>Load demonstration inventory</button>}
      {view.workspace.resourceUses.length > 0 && <><h3>Use log</h3><ul className="plain-list">{view.workspace.resourceUses.map(u => <li key={u.id}>{formatTimestamp(u.at)} · {view.workspace.resources.find(r => r.id === u.resourceId)?.name} · lot {u.lotId} · {u.quantity} · {u.byRole}</li>)}</ul></>}
      <p className="sample-note">Demonstration inventory uses generic categories with no product names, strengths or doses. The forecast is logistics (what stays in date), not clinical need; use the IMM-class planning tools for that.</p>
    </Panel>
  </div>
}
