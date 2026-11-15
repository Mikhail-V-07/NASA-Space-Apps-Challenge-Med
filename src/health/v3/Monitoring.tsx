import { useState } from 'react'
import type { BaselinePolicy } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { formatTimestamp } from '../../app/format'
import { BASELINE_POLICY_BASIS, DEFAULT_BASELINE_POLICY, WINDOW_PRESETS, alignDaily, baselineVersions, describePolicy, inWindow, newerReadings, registry, round, runAnalyses, selectDataset, series } from '../../domain'
import type { WindowPreset, WindowSpec } from '../../domain'
import type { HealthView } from './useHealthView'

export function WindowSelector({ value, onChange }: { value: WindowSpec; onChange(w: WindowSpec): void }) {
  return <div className="chip-row" role="group" aria-label="Analysis window">
    {WINDOW_PRESETS.map(w => <button key={w.id} className="crew-chip" aria-pressed={value.preset === w.id} onClick={() => onChange({ preset: w.id as WindowPreset })}>{w.label}</button>)}
  </div>
}

/** Results of every applicable analysis in the registry of analyses (descriptive). */
export function AnalyticsPanel({ view, parameterId, window }: { view: HealthView; parameterId: string; window: { from: string; to: string } }) {
  const p = registry.parameter(parameterId)
  if (!p || !view.subjectId) return null
  const recs = series(view.workspace.observations, { subjectId: view.subjectId, parameterId, origin: view.origin, includeUnusable: true }).filter(o => o.effectiveAt <= view.now)
  const plan = view.workspace.plans.find(x => x.status === 'active' && x.parameterIds.includes(parameterId))
  const results = runAnalyses(recs, p, { window, now: view.now, expectedEveryHours: plan?.schedule.everyHours ?? null })
  return <Panel title="Assessment" eyebrow={`${p.code} · ${formatTimestamp(window.from)} → ${formatTimestamp(window.to)}`}>
    {results.length ? <dl className="metadata stats">{results.map(r => <div key={r.id}><dt>{r.label}</dt><dd><strong>{r.value}</strong> · {r.detail}{r.limitation && <span className="muted"> — {r.limitation}</span>}</dd></div>)}</dl> : <p className="empty-copy">No data in this window.</p>}
    {!plan && <p className="sample-note">Completeness needs an expected cadence; none is set because no active plan item includes {p.code}.</p>}
    <p className="sample-note">Descriptions of the data, not health judgements. Trend direction is reported only when its 95% interval excludes zero.</p>
  </Panel>
}

/** Baseline versions, policy editor and recalculation. */
export function BaselinePanel({ view, parameterId }: { view: HealthView; parameterId: string }) {
  const p = registry.parameter(parameterId)
  const [policy, setPolicy] = useState<BaselinePolicy>(DEFAULT_BASELINE_POLICY)
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  if (!p || !view.subjectId || p.valueType === 'waveform' || p.status !== 'active') return null
  const recs = series(view.workspace.observations, { subjectId: view.subjectId, parameterId, origin: view.origin }).filter(o => o.effectiveAt <= view.now)
  const versions = baselineVersions(view.workspace.baselines, view.subjectId, parameterId)
  const effective: BaselinePolicy = policy.dataset.type === 'window' ? { ...policy, dataset: { type: 'window', from: from ? new Date(from).toISOString() : recs[0]?.effectiveAt ?? view.now, to: to ? new Date(to).toISOString() : view.now } } : policy
  const preview = selectDataset(recs, effective)
  const current = versions.filter(b => b.status !== 'superseded').at(-1)
  return <Panel title="Personal baseline" eyebrow={`${p.code} · ${versions.length} version(s)`}>
    {versions.length > 0 && <div className="table-wrap"><table><caption>Baseline history</caption>
      <thead><tr><th>Version</th><th>Value</th><th>Policy</th><th>Status</th><th>Set</th></tr></thead>
      <tbody>{[...versions].reverse().map(b => <tr key={b.id}><td>v{b.version ?? 1}</td><td>{round(b.value)} (n={b.summary.n}, {round(b.summary.min)}–{round(b.summary.max)})</td><td>{b.policy ? describePolicy(b.policy) : 'selected readings (v3.0)'}</td><td>{b.status}{b.note ? <span className="muted"> · {b.note}</span> : null}</td><td>{formatTimestamp(b.establishedAt)} · {b.establishedByRole}</td></tr>)}</tbody>
    </table></div>}
    {current && <p className="muted">{newerReadings(current, recs)} valid reading(s) newer than the current baseline window.</p>}
    {!view.readOnly && <form className="entry-form" onSubmit={e => { e.preventDefault(); view.send({ type: 'baseline/compute', subjectId: view.subjectId!, parameterId, policy: effective }) }}>
      <div className="control-row">
        <label className="field">Method<select value={policy.method} onChange={e => setPolicy({ ...policy, method: e.target.value as BaselinePolicy['method'] })}><option value="median">Median</option><option value="mean">Mean</option></select></label>
        <label className="field">Dataset<select value={policy.dataset.type} onChange={e => setPolicy({ ...policy, dataset: e.target.value === 'window' ? { type: 'window', from: view.now, to: view.now } : { type: 'last_n', n: 14 } })}><option value="last_n">Last N valid readings</option><option value="window">Date window</option></select></label>
        {policy.dataset.type === 'last_n' && <label className="field">N<input type="number" min={3} max={500} value={policy.dataset.n} onChange={e => setPolicy({ ...policy, dataset: { type: 'last_n', n: Number(e.target.value) } })} /></label>}
        {policy.dataset.type === 'window' && <><label className="field">From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="field">To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label></>}
        <label className="field">Minimum readings<input type="number" min={3} max={500} value={policy.minReadings} onChange={e => setPolicy({ ...policy, minReadings: Number(e.target.value) })} /></label>
      </div>
      <p className="muted">Would use {preview.length} valid reading(s); needs at least {policy.minReadings}.</p>
      <div className="control-row">
        <button className="button" type="submit" disabled={preview.length < policy.minReadings}>{current ? 'Recalculate (new version)' : 'Propose baseline'}</button>
        {view.role === 'medical' && current?.status === 'proposed' && <button type="button" className="button primary" onClick={() => view.send({ type: 'baseline/accept', baselineId: current.id })}>Accept v{current.version ?? 1}</button>}
      </div>
    </form>}
    <p className="sample-note">{BASELINE_POLICY_BASIS} A baseline is a summary of this person’s own readings, not a normal range. Three readings is only the arithmetic floor; the default asks for more.</p>
  </Panel>
}

/** Side-by-side daily means for several parameters (multi-parameter view). */
export function CompareView({ view, window }: { view: HealthView; window: { from: string; to: string } }) {
  const candidates = registry.parameters.filter(p => p.status === 'active' && p.valueType !== 'waveform')
  const [chosen, setChosen] = useState<string[]>(['sleep_duration', 'fatigue', 'resting_hr'])
  if (!view.subjectId) return null
  const bySeries = Object.fromEntries(chosen.map(pid => [pid, inWindow(series(view.workspace.observations, { subjectId: view.subjectId!, parameterId: pid, origin: view.origin }), window)]))
  const rows = alignDaily(bySeries)
  return <Panel title="Compare parameters" eyebrow="Daily mean per parameter">
    <div className="chip-row">{candidates.map(p => <label key={p.id} className="check-label"><input type="checkbox" checked={chosen.includes(p.id)} onChange={e => setChosen(e.target.checked ? [...chosen, p.id].slice(-6) : chosen.filter(x => x !== p.id))} />{p.code}</label>)}</div>
    {rows.length ? <div className="table-wrap"><table><caption>Daily means (UTC days)</caption>
      <thead><tr><th>Day</th>{chosen.map(pid => <th key={pid}>{registry.parameter(pid)?.code}</th>)}</tr></thead>
      <tbody>{rows.slice(-31).reverse().map(r => <tr key={r.day}><td>{r.day}</td>{chosen.map(pid => <td key={pid}>{r.values[pid] === null || r.values[pid] === undefined ? '—' : round(r.values[pid]!)}</td>)}</tr>)}</tbody>
    </table></div> : <p className="empty-copy">No data for the chosen parameters in this window.</p>}
    <p className="sample-note">Values side by side show co-occurrence only; they do not establish a relationship.</p>
  </Panel>
}
