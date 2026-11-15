import { useState } from 'react'
import type { CarePlanItem, PlanDomain } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { formatTimestamp } from '../../app/format'
import { PLAN_DOMAINS, adherence, dailyTotals, demonstrationPlans, occurrenceStatus, registry, round, series } from '../../domain'
import type { HealthView } from './useHealthView'

const DAY = 86_400_000
const STATUS_LABEL = { done: 'Done', evidenced: 'Logged (from readings)', skipped: 'Skipped', missed: 'Not logged', open: 'Due now', upcoming: 'Upcoming' } as const

export function PreventionView({ view }: { view: HealthView }) {
  const plans = view.workspace.plans
  const from7 = new Date(Date.parse(view.now) - 7 * DAY).toISOString()
  const all = plans.filter(p => p.status === 'active').flatMap(p => occurrenceStatus(p, view.workspace.completions, view.workspace.observations, from7, view.now))
  const overall = adherence(all)
  return <div className="stack">
    <Panel title="Preventive plan" eyebrow={`${plans.filter(p => p.status === 'active').length} active item(s) · last 7 days ${overall.fraction === null ? '—' : `${overall.done}/${overall.due} logged`}`}>
      {plans.length ? <div className="stack">{plans.map(p => <PlanItemCard key={p.id} view={view} item={p} />)}</div> : <p className="empty-copy">No plan items yet. Plan items are defined in the CMO context{view.synthetic ? '' : ', or a labelled demonstration plan can be loaded'}.</p>}
      {!view.readOnly && view.role === 'medical' && view.subjectId && !plans.some(p => p.source === 'demonstration') && <button className="button" onClick={() => view.send({ type: 'plan/seed', items: demonstrationPlans(view.subjectId!, new Date(Date.parse(view.now.slice(0, 10))).toISOString(), () => crypto.randomUUID(), view.now) })}>Load demonstration plan</button>}
      {!view.readOnly && view.subjectId && <button className="button" onClick={() => view.send({ type: 'encounter/open', subjectId: view.subjectId!, concern: 'Preventive plan review requested', trigger: { type: 'preventive_review', refIds: plans.map(p => p.id) }, observationIds: [] })}>Request CMO review of the plan</button>}
      <p className="sample-note">Plan items set what to log and how often. They carry no clinical targets; cadences in demonstration plans are illustrative. Logged readings of a plan’s parameters count toward adherence automatically.</p>
    </Panel>
    {view.role === 'medical' && !view.readOnly && <PlanForm view={view} />}
    <IntakeTotals view={view} />
  </div>
}

function PlanItemCard({ view, item }: { view: HealthView; item: CarePlanItem }) {
  const from = new Date(Date.parse(view.now) - 7 * DAY).toISOString()
  const occ = occurrenceStatus(item, view.workspace.completions, view.workspace.observations, from, view.now)
  const a = adherence(occ)
  const actionable = occ.filter(o => o.status === 'open' || o.status === 'missed').slice(-3)
  const [reason, setReason] = useState('')
  return <article className="care-item plan-item" aria-label={item.title}>
    <header><span className="badge neutral">{PLAN_DOMAINS.find(d => d.id === item.domain)?.label}</span> <strong>{item.title}</strong> <span className="muted">every {item.schedule.everyHours} h · {item.status}{item.demonstrationOnly ? ' · demonstration' : ''} · source: {item.source.replace('_', ' ')}</span></header>
    {item.instructions && <p className="muted">{item.instructions}</p>}
    <p>Last 7 days: {a.fraction === null ? 'no completed slots yet' : `${a.done} of ${a.due} logged (${Math.round(a.fraction * 100)}%), ${a.skipped} skipped, ${a.missed} not logged`}.</p>
    <div className="occ-strip" aria-label="Recent occurrences">{occ.slice(-14).map(o => <span key={o.dueAt} className={`occ occ-${o.status}`} title={`${formatTimestamp(o.dueAt)} · ${STATUS_LABEL[o.status]}`}>{STATUS_LABEL[o.status][0]}</span>)}</div>
    {!view.readOnly && item.status === 'active' && actionable.map(o => <div key={o.dueAt} className="control-row">
      <span className="muted">{formatTimestamp(o.dueAt)} · {STATUS_LABEL[o.status]}</span>
      <button className="button" onClick={() => view.send({ type: 'plan/complete', planItemId: item.id, dueAt: o.dueAt, status: 'done', observationIds: [] })}>Mark done</button>
      <input aria-label="Reason for skipping" placeholder="reason" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} />
      <button className="button" disabled={!reason.trim()} onClick={() => { view.send({ type: 'plan/complete', planItemId: item.id, dueAt: o.dueAt, status: 'skipped', observationIds: [], note: reason }); setReason('') }}>Skip</button>
    </div>)}
    {view.role === 'medical' && !view.readOnly && <div className="control-row">
      {item.status === 'active' ? <button className="button" onClick={() => view.send({ type: 'plan/status', planItemId: item.id, status: 'paused' })}>Pause</button> : item.status === 'paused' ? <button className="button" onClick={() => view.send({ type: 'plan/status', planItemId: item.id, status: 'active' })}>Resume</button> : null}
      {item.status !== 'ended' && <button className="button" onClick={() => view.send({ type: 'plan/status', planItemId: item.id, status: 'ended' })}>End</button>}
    </div>}
    {item.parameterIds.length > 0 && <p className="sample-note">Linked parameters: {item.parameterIds.map(id => registry.parameter(id)?.code ?? id).join(', ')}{item.encounterId ? ' · created from a care encounter' : ''}</p>}
  </article>
}

function PlanForm({ view }: { view: HealthView }) {
  const [domain, setDomain] = useState<PlanDomain>('measurement'), [title, setTitle] = useState(''), [instructions, setInstructions] = useState('')
  const [every, setEvery] = useState('24'), [params, setParams] = useState<string[]>([]), [source, setSource] = useState<CarePlanItem['source']>('cmo')
  const [encounterId, setEncounterId] = useState('')
  const recordable = registry.parameters.filter(p => p.status === 'active' && p.manualEntry)
  return <Panel title="Add plan item" eyebrow="CMO">
    <form className="entry-form" onSubmit={e => { e.preventDefault(); view.send({ type: 'plan/create', subjectId: view.subjectId!, domain, title, instructions, parameterIds: params, everyHours: Number(every), startAt: view.now, endAt: null, source, ...(encounterId ? { encounterId } : {}) }); setTitle(''); setInstructions(''); setParams([]) }}>
      <div className="control-row">
        <label className="field">Domain<select value={domain} onChange={e => setDomain(e.target.value as PlanDomain)}>{PLAN_DOMAINS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label className="field">Every (hours)<input type="number" min={1} max={744} value={every} onChange={e => setEvery(e.target.value)} /></label>
        <label className="field">Defined by<select value={source} onChange={e => setSource(e.target.value as CarePlanItem['source'])}><option value="cmo">CMO</option><option value="ground_prescribed">Ground team (transcribed)</option></select></label>
      </div>
      <label className="field">Title<input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
      <label className="field">Instructions (as given by the CMO or ground; no targets are inferred)<textarea value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)} /></label>
      <fieldset className="field"><legend>Parameters that evidence completion</legend><div className="chip-row">{recordable.map(p => <label key={p.id} className="check-label"><input type="checkbox" checked={params.includes(p.id)} onChange={e => setParams(e.target.checked ? [...params, p.id] : params.filter(x => x !== p.id))} />{p.code}</label>)}</div></fieldset>
      {view.workspace.encounters.length > 0 && <label className="field">From encounter (optional)<select value={encounterId} onChange={e => setEncounterId(e.target.value)}><option value="">—</option>{view.workspace.encounters.map(x => <option key={x.id} value={x.id}>{x.concern.slice(0, 60)}</option>)}</select></label>}
      <button className="button primary" disabled={!title.trim()}>Add plan item</button>
    </form>
  </Panel>
}

function IntakeTotals({ view }: { view: HealthView }) {
  if (!view.subjectId) return null
  const rows = (['fluid_intake', 'energy_intake'] as const).map(pid => ({ pid, totals: dailyTotals(series(view.workspace.observations, { subjectId: view.subjectId!, parameterId: pid, origin: view.origin }).filter(o => o.effectiveAt <= view.now)).slice(-7) }))
  if (rows.every(r => !r.totals.length)) return null
  const days = [...new Set(rows.flatMap(r => r.totals.map(t => t.day)))].sort().reverse()
  return <Panel title="Hydration & nutrition logs" eyebrow="Daily totals · last 7 logged days">
    <div className="table-wrap"><table><caption>Daily logged totals</caption>
      <thead><tr><th>Day</th>{rows.map(r => <th key={r.pid}>{registry.parameter(r.pid)?.displayName} ({registry.parameter(r.pid)?.canonicalUnitId})</th>)}</tr></thead>
      <tbody>{days.map(d => <tr key={d}><td>{d}</td>{rows.map(r => { const t = r.totals.find(x => x.day === d); return <td key={r.pid}>{t ? `${round(t.total)} (${t.n} log${t.n > 1 ? 's' : ''})` : '—'}</td> })}</tr>)}</tbody>
    </table></div>
    <p className="sample-note">Totals of what was logged. AEGIS sets no intake targets; a low total may mean unlogged intake.</p>
  </Panel>
}
