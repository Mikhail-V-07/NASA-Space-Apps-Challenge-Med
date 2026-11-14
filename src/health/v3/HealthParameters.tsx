import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Observation, ParameterDefinition } from '../../../contracts/types'
import { Panel } from '../../app/components/Panel'
import { formatTimestamp } from '../../app/format'
import { activeBaseline, createObservation, createWaveformObservation, differenceFromBaseline, formatValue, freshness, registry, round, series, summarize } from '../../domain'
import { TrendChart, WaveformChart } from './charts'
import type { HealthView } from './useHealthView'

const unitSymbol = (p: ParameterDefinition) => p.valueType === 'ordinal' ? `${p.scale?.min}–${p.scale?.max}` : p.canonicalUnitId ? registry.unit(p.canonicalUnitId)?.symbol ?? p.canonicalUnitId : 'unit TBD'
const latestOf = (view: HealthView, parameterId: string) => series(view.workspace.observations, { subjectId: view.subjectId ?? '', parameterId, origin: view.synthetic ? 'synthetic' : 'observed', includeUnusable: true }).at(-1)

/** Overview of every registered parameter, grouped by registry category. */
export function ParameterOverview({ view, selected, onSelect }: { view: HealthView; selected: string; onSelect(id: string): void }) {
  const now = new Date().toISOString()
  return <Panel title="Health parameters" eyebrow={`${registry.parameters.filter(p => p.status === 'active').length} active · ${registry.parameters.filter(p => p.status === 'provisional').length} pending definition`}>
    {[...registry.categories].sort((a, b) => a.order - b.order).map(c => {
      const params = registry.parameters.filter(p => p.categoryId === c.id && p.status !== 'retired')
      if (!params.length) return null
      return <section key={c.id} className="param-section" aria-label={c.label}>
        <h3 className="eyebrow">{c.label}</h3>
        <div className="param-grid">{params.map(p => {
          const last = latestOf(view, p.id), fresh = last ? freshness([last], now) : null
          return <button key={p.id} className="param-tile" aria-pressed={selected === p.id} onClick={() => onSelect(p.id)}>
            <span className="param-code mono">{p.code}</span>
            <span className="param-name">{p.displayName}</span>
            <span className={last && last.quality !== 'missing' ? 'param-value' : 'param-value empty'}>{p.status === 'provisional' ? 'Definition pending' : last?.value?.type === 'waveform' ? `${last.value.samples.length} samples` : last ? formatValue(last, registry) : 'No data'}</span>
            <span className="param-meta">{p.status === 'provisional' ? 'Unit / method TBD' : fresh ? `${fresh.ageHours < 1 ? '<1 h' : fresh.ageHours < 48 ? `${Math.round(fresh.ageHours)} h` : `${Math.round(fresh.ageHours / 24)} d`} ago · ${last?.quality}` : unitSymbol(p)}</span>
          </button>
        })}</div>
      </section>
    })}
    <p className="sample-note">Tiles show data state only (latest value, age, quality). No colour or label marks a value as normal or abnormal: AEGIS has no approved reference values. Parameters are defined in the registry and can be added without changing this view.</p>
  </Panel>
}

/** Detail for one parameter: definition, trend, baseline and provenance table. */
export function ParameterDetail({ view, parameterId }: { view: HealthView; parameterId: string }) {
  const p = registry.parameter(parameterId)
  if (!p) return null
  const origin = view.synthetic ? 'synthetic' : 'observed'
  const all = series(view.workspace.observations, { subjectId: view.subjectId ?? '', parameterId, origin, includeUnusable: true })
  const usable = series(view.workspace.observations, { subjectId: view.subjectId ?? '', parameterId, origin })
  const baseline = activeBaseline(view.workspace.baselines, view.subjectId ?? '', parameterId)
  const summary = summarize(usable), latest = usable.at(-1), diff = latest && baseline ? differenceFromBaseline(latest, baseline) : null
  const unit = unitSymbol(p), waveform = [...all].reverse().find(o => o.value?.type === 'waveform')
  const valid = usable.filter(o => o.quality === 'valid').slice(-3)
  return <Panel title={`${p.displayName} (${p.code})`} eyebrow={`${registry.categories.find(c => c.id === p.categoryId)?.label} · ${p.kind.replace('_', ' ')} · ${unit}`}>
    <p className="muted">{p.description}</p>
    {p.disambiguation && <p className="sample-note">{p.disambiguation}</p>}
    {p.scale && !p.scale.validatedInstrument && <p className="sample-note">Descriptive {p.scale.min}–{p.scale.max} scale ({p.scale.min} = {p.scale.lowAnchor}, {p.scale.max} = {p.scale.highAnchor}). Not a validated questionnaire.</p>}
    {p.status === 'provisional' ? <div className="empty-state"><span className="badge neutral">Definition pending</span><p>The unit{p.derivation ? ', source parameters and derivation method' : ' and data source'} for this parameter are still to be determined. Recording is disabled until the team defines them in the registry.</p></div> : <>
      {p.visualization === 'waveform' ? (waveform?.value?.type === 'waveform' ? <WaveformChart samples={waveform.value.samples} sampleRateHz={waveform.value.sampleRateHz} unit={unit} /> : <p className="empty-copy">No signal recorded. Raw signals are imported from a device export, not typed.</p>)
        : <TrendChart records={usable.slice(-60)} baseline={baseline} unit={unit} label={p.displayName} />}
      {summary && p.visualization !== 'waveform' && <dl className="metadata stats">
        <div><dt>Readings</dt><dd>{summary.n} usable of {all.length}</dd></div>
        <div><dt>Range</dt><dd>{round(summary.min)} – {round(summary.max)} {unit}</dd></div>
        <div><dt>Median</dt><dd>{round(summary.median)} {unit}</dd></div>
        <div><dt>Baseline</dt><dd>{baseline ? `${round(baseline.value)} ${unit} · ${baseline.status} · median of ${baseline.summary.n} (${round(baseline.summary.min)}–${round(baseline.summary.max)})` : 'Not established'}</dd></div>
        {diff && <div><dt>Latest vs baseline</dt><dd>{diff.absolute >= 0 ? '+' : ''}{round(diff.absolute)} {unit}{diff.relativePercent !== null ? ` (${diff.relativePercent >= 0 ? '+' : ''}${round(diff.relativePercent)} %)` : ''} · {diff.withinBaselineSpread ? 'inside' : 'outside'} the range of baseline readings</dd></div>}
      </dl>}
      {!view.readOnly && p.visualization !== 'waveform' && <div className="control-row">
        <button className="button" disabled={valid.length < 3} onClick={() => view.send({ type: 'baseline/propose', subjectId: view.subjectId!, parameterId, observationIds: valid.map(o => o.id) })}>Propose baseline from last 3 valid readings</button>
        {view.role === 'medical' && baseline?.status === 'proposed' && <button className="button primary" onClick={() => view.send({ type: 'baseline/accept', baselineId: baseline.id })}>Accept baseline</button>}
        {valid.length < 3 && <span className="muted">{3 - valid.length} more valid reading(s) needed.</span>}
      </div>}
      <ObservationTable records={all.slice(-15).reverse()} />
    </>}
    <p className="sample-note">Potential sources: {p.potentialSourceIds.map(id => { const s = registry.source(id); return s ? `${s.label}${s.availability === 'not_connected' ? ' (not connected)' : ''}` : id }).join(', ') || 'to be determined'}. Definition: {p.provenance}, v{p.version}.</p>
  </Panel>
}

function ObservationTable({ records }: { records: Observation[] }) {
  if (!records.length) return null
  return <div className="table-wrap"><table><caption>Latest records with provenance</caption>
    <thead><tr><th>Measured (UTC)</th><th>Value</th><th>Source · method · quality</th><th>Context</th></tr></thead>
    <tbody>{records.map(o => <tr key={o.id}><td>{formatTimestamp(o.effectiveAt)}</td><td>{formatValue(o, registry)}{o.original && <span className="muted"> (entered {round(o.original.value)} {registry.unit(o.original.unitId)?.symbol})</span>}</td><td>{registry.source(o.sourceId)?.label ?? o.sourceId} · {o.method} · {o.quality}{o.demonstrationOnly && ' · synthetic'}</td><td>{[o.context?.condition, o.context?.note].filter(Boolean).join(' — ')}</td></tr>)}</tbody>
  </table></div>
}

/** Registry-driven entry. Parameters in one entry group (e.g. blood pressure) are recorded together. */
export function ObservationEntry({ view, parameterId, onRecorded }: { view: HealthView; parameterId: string; onRecorded?(ids: string[]): void }) {
  const p = registry.parameter(parameterId)
  const group = p?.entryGroupId ? registry.parameters.filter(x => x.entryGroupId === p.entryGroupId && x.status === 'active') : p ? [p] : []
  const [values, setValues] = useState<Record<string, string>>({}), [units, setUnits] = useState<Record<string, string>>({})
  const [at, setAt] = useState(''), [condition, setCondition] = useState(''), [note, setNote] = useState(''), [error, setError] = useState('')
  const [samples, setSamples] = useState(''), [rate, setRate] = useState('')
  if (!p || view.readOnly || !view.subjectId) return null
  if (p.status !== 'active') return null
  const subjectId = view.subjectId
  function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const now = new Date().toISOString(), effectiveAt = at ? new Date(at).toISOString() : now
      const context = { condition, note }
      const records = p!.valueType === 'waveform'
        ? [createWaveformObservation({ id: crypto.randomUUID(), subjectId, parameterId: p!.id, samples: parseSamples(samples), sampleRateHz: Number(rate), unitId: p!.canonicalUnitId!, effectiveAt, recordedAt: now, sourceId: 'file-import', method: 'dataset_import', origin: 'observed', context }, registry)]
        : group.map(g => {
          const raw = values[g.id]?.trim() ?? ''
          if (!raw) throw new Error(`Enter ${g.displayName}. Missing is not zero.`)
          return createObservation({ id: crypto.randomUUID(), subjectId, parameterId: g.id, value: Number(raw), unitId: units[g.id] ?? g.canonicalUnitId ?? '', effectiveAt, recordedAt: now, sourceId: 'manual-entry', method: 'manual', origin: 'observed', context }, registry)
        })
      for (const record of records) view.send({ type: 'observation/record', record })
      onRecorded?.(records.map(r => r.id))
      setValues({}); setNote(''); setSamples('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid input') }
  }
  return <Panel title={p.valueType === 'waveform' ? `Import ${p.code} signal` : `Record ${group.map(g => g.code).join(' / ')}`} eyebrow="Observed · manual entry">
    <form className="entry-form" onSubmit={submit}>
      {p.valueType === 'waveform' ? <>
        <label className="field">Samples ({unitSymbol(p)}), comma- or space-separated, or a JSON array<textarea value={samples} onChange={e => setSamples(e.target.value)} placeholder="0.01, 0.02, 0.15, …" /></label>
        <label className="field">Sample rate (Hz)<input type="number" step="any" min="0" value={rate} onChange={e => setRate(e.target.value)} /></label>
      </> : group.map(g => <div className="control-row" key={g.id}>
        <label className="field">{g.displayName} ({g.valueType === 'ordinal' ? `${g.scale?.min}–${g.scale?.max}` : registry.unit(units[g.id] ?? g.canonicalUnitId ?? '')?.symbol})<input type="number" step={g.valueType === 'ordinal' ? 1 : 'any'} min={g.entry?.min ?? g.scale?.min} max={g.entry?.max ?? g.scale?.max} value={values[g.id] ?? ''} onChange={e => setValues({ ...values, [g.id]: e.target.value })} /></label>
        {g.acceptedUnitIds.length > 1 && <label className="field">Unit<select value={units[g.id] ?? g.canonicalUnitId ?? ''} onChange={e => setUnits({ ...units, [g.id]: e.target.value })}>{g.acceptedUnitIds.map(u => <option key={u} value={u}>{registry.unit(u)?.symbol}</option>)}</select></label>}
      </div>)}
      <label className="field">Measured at (optional, local time)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
      <label className="field">Condition (optional)<input value={condition} maxLength={500} onChange={e => setCondition(e.target.value)} placeholder="e.g. seated, after 5 min rest" /></label>
      <label className="field">Note{p.requiresNote ? ' (required)' : ' (optional)'}<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
      <button className="button primary" type="submit">Save</button>
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>
    <p className="sample-note">Input checks are definitional (e.g. a percentage cannot exceed 100). They are not health ranges.</p>
  </Panel>
}

function parseSamples(text: string): number[] {
  const t = text.trim()
  const values = t.startsWith('[') ? JSON.parse(t) as unknown[] : t.split(/[\s,;]+/).filter(Boolean).map(Number)
  if (!values.length || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Samples must be finite numbers.')
  return values as number[]
}
