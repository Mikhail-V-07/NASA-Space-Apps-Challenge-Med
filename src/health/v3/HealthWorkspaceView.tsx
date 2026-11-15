import { useState } from 'react'
import { Panel } from '../../app/components/Panel'
import { useAppState } from '../../app/state/context'
import { formatTimestamp } from '../../app/format'
import { registry, resolveWindow } from '../../domain'
import type { WindowSpec } from '../../domain'
import { V3_SCENARIOS } from '../../simulation/v3'
import type { V3ScenarioId } from '../../simulation/v3'
import { AssistantView } from './AssistantView'
import { AttentionList, RulesPanel } from './Attention'
import { CarePanel } from './CarePanel'
import { ObservationEntry, ParameterDetail, ParameterOverview } from './HealthParameters'
import { MissionResourcesView } from './MissionResources'
import { AnalyticsPanel, BaselinePanel, CompareView, WindowSelector } from './Monitoring'
import { PreventionView } from './Prevention'
import { ProfileView } from './ProfileView'
import { useHealthView } from './useHealthView'

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'monitoring', label: 'Monitoring' }, { id: 'analytics', label: 'Analytics' },
  { id: 'prevention', label: 'Prevention' }, { id: 'care', label: 'Care' }, { id: 'profile', label: 'Profile' },
  { id: 'resources', label: 'Mission & resources' }, { id: 'assistant', label: 'Knowledge & assistant' },
] as const
type Tab = typeof TABS[number]['id']

/** v3.1 health workspace: Profile → Monitoring → Analytics → Prevention/Care → follow-up → updated Profile. */
export function HealthWorkspaceView() {
  const view = useHealthView()
  const [tab, setTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState(registry.parameters.find(p => p.status === 'active')!.id)
  const [win, setWin] = useState<WindowSpec>({ preset: '14d' })
  if (!view.subjectId) return <p className="empty-copy">Select a crew member.</p>
  const earliest = view.workspace.observations.reduce<string | undefined>((m, o) => !m || o.effectiveAt < m ? o.effectiveAt : m, undefined)
  const window = resolveWindow(win, view.now, earliest)
  const open = view.workspace.encounters.filter(e => e.status !== 'closed').length
  return <div className="stack">
    {view.synthetic && <SimulatorBar />}
    <nav className="tab-row" role="tablist" aria-label="Health workspace">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
      {t.label}{t.id === 'analytics' && view.attention.length ? ` (${view.attention.length})` : ''}{t.id === 'care' && open ? ` (${open})` : ''}
    </button>)}</nav>
    {tab === 'overview' && <div className="stack">
      <AttentionList view={view} compact />
      <ParameterOverview view={view} selected={selected} onSelect={id => { setSelected(id); setTab('monitoring') }} />
    </div>}
    {tab === 'monitoring' && <div className="stack">
      <div className="control-row"><label className="field">Parameter<select value={selected} onChange={e => setSelected(e.target.value)}>{registry.parameters.filter(p => p.status !== 'retired').map(p => <option key={p.id} value={p.id}>{p.code} · {p.displayName}</option>)}</select></label><WindowSelector value={win} onChange={setWin} /></div>
      <div className="content-grid">
        <ParameterDetail view={view} parameterId={selected} window={window} />
        <div className="stack">
          <ObservationEntry key={`${selected}-${view.subjectId}`} view={view} parameterId={selected} />
          <BaselinePanel key={`b-${selected}-${view.subjectId}`} view={view} parameterId={selected} />
        </div>
      </div>
    </div>}
    {tab === 'analytics' && <div className="stack">
      <div className="control-row"><label className="field">Parameter<select value={selected} onChange={e => setSelected(e.target.value)}>{registry.parameters.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.code} · {p.displayName}</option>)}</select></label><WindowSelector value={win} onChange={setWin} /></div>
      <div className="content-grid"><AnalyticsPanel view={view} parameterId={selected} window={window} /><AttentionList view={view} /></div>
      <CompareView view={view} window={window} />
      <RulesPanel view={view} />
    </div>}
    {tab === 'prevention' && <PreventionView view={view} />}
    {tab === 'care' && <CarePanel view={view} selectedParameterId={selected} />}
    {tab === 'profile' && <ProfileView view={view} />}
    {tab === 'resources' && <MissionResourcesView view={view} />}
    {tab === 'assistant' && <AssistantView view={view} />}
  </div>
}

function SimulatorBar() {
  const { state, dispatch } = useAppState()
  const [scenario, setScenario] = useState<V3ScenarioId>(state.sim.scenario), [seed, setSeed] = useState(String(state.sim.seed)), [days, setDays] = useState(String(state.sim.days))
  return <Panel title="Synthetic health workspace" eyebrow={`Simulator · ${V3_SCENARIOS.find(s => s.id === state.sim.scenario)?.label} · seed ${state.sim.seed} · clock ${formatTimestamp(state.sim.now)}`}>
    <p className="notice" role="note">SYNTHETIC DATA. Generated by a seeded simulator to exercise AEGIS workflows. Values are not physiological predictions and scenarios do not model real conditions. Everything you record here stays in the synthetic workspace.</p>
    <form className="control-row" onSubmit={e => { e.preventDefault(); dispatch({ type: 'sim/generate', scenario, seed: Number(seed), days: Number(days) }) }}>
      <label className="field">Scenario<select value={scenario} onChange={e => setScenario(e.target.value as V3ScenarioId)}>{V3_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label className="field">Seed<input type="number" min={0} value={seed} onChange={e => setSeed(e.target.value)} /></label>
      <label className="field">Days<input type="number" min={1} max={120} value={days} onChange={e => setDays(e.target.value)} /></label>
      <button className="button">Regenerate (replaces synthetic records)</button>
      <button type="button" className="button" onClick={() => dispatch({ type: 'sim/advance', hours: 24 })}>Advance clock 24 h</button>
    </form>
    <p className="sample-note">{V3_SCENARIOS.find(s => s.id === scenario)?.description}</p>
  </Panel>
}
