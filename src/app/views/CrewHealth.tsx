import type { ModuleViews } from '../integration/interfaces'
import { useAppState } from '../state/context'
import { selectWorkspace } from '../state/reducer'
import { HealthWorkspaceView } from '../../health/v3/HealthWorkspaceView'

export function CrewHealth({ modules }: { modules: ModuleViews }) {
  const { state, dispatch } = useAppState(), mission = selectWorkspace(state)
  const Health = modules.health
  return <><div className="page-intro"><div><p className="eyebrow">{state.mode === 'medical' ? 'Crew medical officer' : state.mode === 'mission' ? 'Synthetic mission profile' : 'Astronaut / Personal monitor'}</p><h1>{state.mode === 'astronaut' ? 'My Health' : 'Crew Health'}</h1><p className="muted">{state.scope === 'synthetic' ? 'Simulation preview. These are not real health assessments.' : 'Observed records, personal baselines, concerns and follow-up.'}</p></div>
    {state.mode !== 'astronaut' && <label className="select-label">Crew member<select value={state.selectedAstronautId ?? ''} onChange={e => dispatch({ type: 'crew/select', id: e.target.value })}>{mission.crew.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>}
  </div>{Health ? <Health mission={mission} astronautId={state.selectedAstronautId} onMeasurementAdded={record => dispatch({ type: 'measurements/upsert', records: [record] })} onAcknowledgeAlert={id => dispatch({ type: 'alerts/acknowledge', id })} /> : <HealthWorkspaceView />}</>
}
