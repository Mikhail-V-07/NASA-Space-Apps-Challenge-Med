import type { Baseline, Observation } from '../../../contracts/types'
import { numericValue, round } from '../../domain'

/**
 * Parameter-agnostic trend chart. Draws readings on a time axis and, when present, the personal
 * baseline and the spread of the readings that formed it. No colour encodes "good" or "bad":
 * AEGIS has no approved reference values to justify that.
 */
export function TrendChart({ records, baseline, unit, label }: { records: Observation[]; baseline?: Baseline | undefined; unit: string; label: string }) {
  const points = records.map(o => ({ o, v: numericValue(o), t: Date.parse(o.effectiveAt) })).filter((p): p is { o: Observation; v: number; t: number } => p.v !== null)
  if (!points.length) return <p className="empty-copy">No usable readings yet. Missing or invalid readings are not plotted as zero.</p>
  const values = [...points.map(p => p.v), ...(baseline ? [baseline.summary.min, baseline.summary.max, baseline.value] : [])]
  let low = Math.min(...values), high = Math.max(...values)
  if (low === high) { low -= 1; high += 1 }
  const t0 = points[0]!.t, span = Math.max(1, points.at(-1)!.t - t0)
  const W = 560, H = 190, L = 48, R = 16, T = 14, B = 34
  const x = (t: number) => points.length === 1 ? L + (W - L - R) / 2 : L + (t - t0) / span * (W - L - R)
  const y = (v: number) => T + (1 - (v - low) / (high - low)) * (H - T - B)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const description = `${label}: ${points.map(p => `${round(p.v)} ${unit} at ${p.o.effectiveAt}`).join('; ')}${baseline ? `. Baseline ${round(baseline.value)} ${unit}.` : ''}`
  return <figure className="chart">
    <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
      {baseline && <g>
        <rect x={L} width={W - L - R} y={y(baseline.summary.max)} height={Math.max(1, y(baseline.summary.min) - y(baseline.summary.max))} fill="#a8d8ce" opacity=".08" />
        <line x1={L} x2={W - R} y1={y(baseline.value)} y2={y(baseline.value)} stroke="#d9c79a" strokeDasharray="5 4" />
        <text x={W - R} y={y(baseline.value) - 5} textAnchor="end" fontSize="11" fill="#d9c79a">baseline {round(baseline.value)}</text>
      </g>}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="currentColor" opacity=".3" />
      <text x={L - 6} y={y(high) + 4} textAnchor="end" fontSize="11" fill="currentColor">{round(high)}</text>
      <text x={L - 6} y={y(low) + 4} textAnchor="end" fontSize="11" fill="currentColor">{round(low)}</text>
      <path d={path} fill="none" stroke="#a8d8ce" strokeWidth="2" />
      {points.map(p => <circle key={p.o.id} cx={x(p.t)} cy={y(p.v)} r="4" fill={p.o.quality === 'estimated' ? '#18232b' : '#a8d8ce'} stroke="#a8d8ce"><title>{p.o.effectiveAt}: {round(p.v)} {unit} · {p.o.quality}</title></circle>)}
      <text x={L} y={H - 10} fontSize="11" fill="currentColor">{points[0]!.o.effectiveAt.slice(0, 16).replace('T', ' ')}</text>
      <text x={W - R} y={H - 10} fontSize="11" fill="currentColor" textAnchor="end">{points.at(-1)!.o.effectiveAt.slice(0, 16).replace('T', ' ')} UTC · {unit}</text>
    </svg>
    <figcaption className="muted">Filled points: valid readings; hollow: estimated. {baseline ? 'Dashed line: personal baseline (median); band: range of the readings that formed it. Descriptive only, not a normal range.' : 'No baseline established.'}</figcaption>
  </figure>
}

/** Raw-signal display. Samples are drawn as recorded; nothing is detected or interpreted. */
export function WaveformChart({ samples, sampleRateHz, unit }: { samples: number[]; sampleRateHz: number; unit: string }) {
  const shown = samples.slice(0, 5000)
  let low = Math.min(...shown), high = Math.max(...shown)
  if (low === high) { low -= 1; high += 1 }
  const W = 560, H = 150
  const d = shown.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, shown.length - 1) * W).toFixed(1)},${(8 + (1 - (v - low) / (high - low)) * (H - 16)).toFixed(1)}`).join(' ')
  return <figure className="chart">
    <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Raw signal, ${shown.length} samples at ${sampleRateHz} Hz, ${round(low)} to ${round(high)} ${unit}`}><path d={d} fill="none" stroke="#a8d8ce" strokeWidth="1.2" /></svg>
    <figcaption className="muted">{shown.length} of {samples.length} samples · {sampleRateHz} Hz · {(samples.length / sampleRateHz).toFixed(2)} s · {round(low)} to {round(high)} {unit}. Displayed as recorded; AEGIS does not analyse rhythm.</figcaption>
  </figure>
}
