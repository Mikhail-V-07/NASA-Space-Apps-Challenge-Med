import type { ModuleViews } from './integration/interfaces'
import { selectWorkspace } from './state/reducer'
import type { Section, UserMode } from './state/reducer'
import { useAppState } from './state/context'
import { formatTimestamp } from './format'
import { MissionView } from '../mission/MissionView'
import { SimulationControls } from '../simulation/SimulationControls'
import { Assessments } from '../health/Assessments'
import { Research } from '../health/Research'
import { Dashboard } from './views/Dashboard'
import { CrewHealth } from './views/CrewHealth'
import { Events } from './views/Events'

const navigation: { id: Section; label: string; mark: string }[] = [
  { id: 'dashboard', label: 'Mission Dashboard', mark: '01' },
  { id: 'health', label: 'Crew Health', mark: '02' },
  { id: 'spacecraft', label: 'Spacecraft', mark: '03' },
  { id: 'simulation', label: 'Mission Simulation', mark: '04' },
  { id: 'events', label: 'Events & Alerts', mark: '05' },
  { id: 'assessments', label: 'Daily Assessments', mark: '06' },
  { id: 'research', label: 'Research & Sources', mark: '07' },
]

export function App({ modules = {} }: { modules?: ModuleViews }) {
  const { state, dispatch } = useAppState()
  const Spacecraft = modules.spacecraft ?? MissionView, Simulation = modules.simulation
  const workspace = selectWorkspace(state)
  const visibleNavigation = navigation.filter(n => state.mode === 'mission' || !['spacecraft', 'simulation'].includes(n.id))
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar"><a className="brand" href="#" onClick={event => { event.preventDefault(); dispatch({ type: 'navigate', section: 'dashboard' }) }}><span className="brand-symbol" aria-hidden="true">A</span><span>AEGIS<small>Crew health & mission</small></span></a>
      <p className="sidebar-caption">WORKSPACE</p><nav aria-label="Main navigation">{visibleNavigation.map(item => <button key={item.id} className="nav-item" aria-current={state.section === item.id ? 'page' : undefined} onClick={() => dispatch({ type: 'navigate', section: item.id })}><span className="mono" aria-hidden="true">{item.mark}</span>{item.id === 'health' && state.mode === 'astronaut' ? 'My Health' : item.label}</button>)}</nav>
      <div className="sidebar-bottom"><span className="badge neutral">Core v3 · local prototype</span><p>Camera off · no video collection</p><a href="https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/" target="_blank" rel="noreferrer">Challenge reference ↗</a></div>
    </aside>
    <div className="workspace"><header className="topbar"><div><span className="mission-label">{state.mode === 'astronaut' ? 'ASTRONAUT / PERSONAL HEALTH' : state.mode === 'medical' ? 'CREW MEDICAL OFFICER / REVIEW' : 'MISSION OVERVIEW / SYNTHETIC SIMULATION'}</span><p className="mono">{state.scope === 'synthetic' ? formatTimestamp(state.mission.missionTime) : 'Observed records · local device'}</p></div><div className="topbar-status"><label className="select-label">Demo user context<select aria-label="Demo user context" value={state.mode} onChange={e => dispatch({ type: 'mode/set', mode: e.target.value as UserMode })}><option value="astronaut">Astronaut Mode</option><option value="medical">Crew Medical Officer Mode</option><option value="mission">Mission Overview</option></select></label>{state.mode !== 'mission' && <label className="select-label">Data workspace<select value={state.scope} onChange={e => dispatch({ type: 'scope/set', scope: e.target.value as 'observed' | 'synthetic' })}><option value="observed">Observed records</option><option value="synthetic">Synthetic mission preview</option></select></label>}<span className="badge">{state.scope === 'synthetic' ? 'Synthetic mission data' : 'Observed · separate records'}</span></div></header>
      <p className="context-warning">Local demonstration with fictional identities. Role switching is not authentication or authorization. Use only non-sensitive test data.</p>
      {state.notice && <div className="notice" role="status">{state.notice}<button className="text-button" onClick={() => dispatch({ type: 'notice', message: null })}>Dismiss</button></div>}
      <main id="main-content" className="main-content" key={`${state.section}-${state.mode}-${state.scope}-${state.selectedAstronautId}`}>
        {state.section === 'dashboard' && <Dashboard />}
        {state.section === 'health' && <CrewHealth modules={modules} />}
        {state.section === 'spacecraft' && state.mode === 'mission' && <><div className="page-intro"><div><p className="eyebrow">Mission context</p><h1>Spacecraft</h1></div></div><Spacecraft mission={workspace} selectedAstronautId={state.selectedAstronautId} selectedCompartmentId={state.selectedCompartmentId} onSelectAstronaut={id => dispatch({ type: 'crew/select', id })} onSelectCompartment={id => dispatch({ type: 'compartment/select', id })} /></>}
        {state.section === 'simulation' && state.mode === 'mission' && <><div className="page-intro"><div><p className="eyebrow">Mission simulation</p><h1>A reproducible mission.</h1></div></div>{Simulation ? <Simulation mission={workspace} onMissionChanged={mission => dispatch({ type: 'mission/replace', mission })} /> : <SimulationControls />}</>}
        {state.section === 'events' && <Events />}
        {state.section === 'assessments' && <Assessments />}
        {state.section === 'research' && <Research />}
      </main>
      <footer className="footer"><span>AEGIS · Research prototype · {state.scope} workspace</span><span>No clinical diagnosis · No external runtime API</span></footer>
    </div>
  </div>
}
