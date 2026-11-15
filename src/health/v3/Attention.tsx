import { useState } from 'react'
import type { AnalysisRule, AttentionItem } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { useAppState } from '../../app/state/context'
import { formatTimestamp } from '../../app/format'
import { attentionStatus, formatValue, registry } from '../../domain'
import type { HealthView } from './useHealthView'

/** Items needing attention: what the data show, the evidence, the limits — and what people did about it. */
export function AttentionList({ view, compact = false }: { view: HealthView; compact?: boolean }) {
  const items = view.attention
  const open = items.filter(i => attentionStatus(i.id, view.workspace.attention)?.status !== 'dismissed')
  return <Panel title="Needs attention" eyebrow={`${open.length} item(s) · from ${view.rules.filter(r => r.status !== 'disabled').length} configured rules`}>
    {open.length ? <ul className="plain-list attention-list">{open.map(i => <AttentionRow key={i.id} view={view} item={i} compact={compact} />)}</ul> : <p className="empty-copy">Nothing flagged by the configured rules for this person and data workspace.</p>}
    {items.length > open.length && <p className="muted">{items.length - open.length} dismissed item(s) hidden.</p>}
    <p className="sample-note">Items describe data — missing logs, differences from a personal baseline, sustained trends, plan activity. They are not diagnoses or alarms. Every shipped rule is a DEMONSTRATION setting.</p>
  </Panel>
}

function AttentionRow({ view, item, compact }: { view: HealthView; item: AttentionItem; compact: boolean }) {
  const st = attentionStatus(item.id, view.workspace.attention)
  const [note, setNote] = useState('')
  const evidence = view.workspace.observations.filter(o => item.evidenceObservationIds.includes(o.id))
  const linked = st?.encounterId ? view.workspace.encounters.find(e => e.id === st.encounterId) : undefined
  return <li className="attention-item" aria-label={item.title}>
    <p><span className={item.ruleStatus === 'demonstration' ? 'badge demo' : 'badge'}>{item.ruleStatus === 'demonstration' ? 'Demonstration rule' : item.ruleStatus}</span> <strong>{item.title}</strong> {st && <span className="badge neutral">{st.status}</span>}</p>
    <p>{item.explanation}</p>
    {!compact && evidence.length > 0 && <p className="muted">Evidence: {evidence.slice(-6).map(o => `${registry.parameter(o.parameterId)?.code} ${formatValue(o, registry)} (${o.effectiveAt.slice(5, 16).replace('T', ' ')})`).join('; ')}</p>}
    {!compact && <p className="sample-note">{item.limitations.join(' ')} Rule {item.ruleId}.</p>}
    {linked && <p className="muted">Linked to encounter “{linked.concern.slice(0, 60)}” ({linked.status}).</p>}
    {!view.readOnly && !compact && !linked && <div className="control-row">
      {!st && <button className="button" onClick={() => view.send({ type: 'attention/set', itemId: item.id, subjectId: item.subjectId, status: 'acknowledged' })}>Acknowledge</button>}
      <button className="button" onClick={() => view.send({ type: 'encounter/open', subjectId: item.subjectId, concern: `Review: ${item.title}`, trigger: { type: 'attention_item', refIds: [item.id] }, observationIds: item.evidenceObservationIds.filter(id => evidence.some(o => o.id === id)), attentionItemId: item.id })}>Open care encounter</button>
      {view.role === 'medical' && <><label className="field">Reason<input value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label><button className="button" disabled={!note.trim()} onClick={() => view.send({ type: 'attention/set', itemId: item.id, subjectId: item.subjectId, status: 'dismissed', note })}>Dismiss</button></>}
    </div>}
    {st && <p className="muted">{st.status} {formatTimestamp(st.at)} by {st.byRole}{st.note ? ` — ${st.note}` : ''}</p>}
  </li>
}

const mainNumber = (r: AnalysisRule): { key: string; label: string; value: number } | null => {
  const c = r.condition
  switch (c.type) {
    case 'baseline_deviation': return { key: 'percent', label: '% from baseline', value: c.percent }
    case 'stale_data': return { key: 'maxAgeHours', label: 'max age (h)', value: c.maxAgeHours }
    case 'trend': return { key: 'minChangePerDay', label: 'min change/day', value: c.minChangePerDay }
    case 'plan_adherence': return { key: 'minFraction', label: 'min fraction', value: c.minFraction }
    case 'demo_cutoff': return { key: 'value', label: 'demo cutoff', value: c.value }
    default: return null
  }
}

/** Rule configuration (CMO) and transparency (everyone). */
export function RulesPanel({ view }: { view: HealthView }) {
  const { dispatch } = useAppState()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const editable = view.role === 'medical'
  return <Panel title="Analysis rules" eyebrow={editable ? 'CMO configuration' : 'Read-only'}>
    <div className="table-wrap"><table><caption>Configured rules</caption>
      <thead><tr><th>Rule</th><th>Condition</th><th>Status</th><th>Setting</th><th>Basis</th></tr></thead>
      <tbody>{view.rules.map(r => { const m = mainNumber(r); return <tr key={r.id}>
        <td><strong>{r.title}</strong><br /><span className="mono muted">{r.id} · v{r.version}</span></td>
        <td>{r.description} <span className="muted">({r.condition.type}{'parameterId' in r.condition ? ` · ${registry.parameter(r.condition.parameterId)?.code}` : ''})</span></td>
        <td>{editable ? <select aria-label={`Status of ${r.id}`} value={r.status} onChange={e => dispatch({ type: 'rules/update', rule: { ...r, status: e.target.value as AnalysisRule['status'] } })}><option value="demonstration">demonstration</option><option value="disabled">disabled</option></select> : r.status}</td>
        <td>{m ? editable ? <form className="control-row" onSubmit={e => { e.preventDefault(); const v = Number(edits[r.id]); if (Number.isFinite(v)) dispatch({ type: 'rules/update', rule: { ...r, condition: { ...r.condition, [m.key]: v } as AnalysisRule['condition'] } }) }}><input aria-label={`${m.label} for ${r.id}`} type="number" step="any" value={edits[r.id] ?? String(m.value)} onChange={e => setEdits({ ...edits, [r.id]: e.target.value })} /><button className="button">Set</button></form> : `${m.label}: ${m.value}` : '—'}</td>
        <td className="muted">{r.basis}</td>
      </tr> })}</tbody>
    </table></div>
    {editable && <button className="button" onClick={() => dispatch({ type: 'rules/reset' })}>Reset to shipped demonstration rules</button>}
    <p className="sample-note">No rule can be marked approved inside AEGIS. Rules with approved clinical reference values would require the mission medical authority; none are loaded.</p>
  </Panel>
}
