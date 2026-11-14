import { useState } from 'react'
import { registry } from '../../domain'
import { CarePanel } from './CarePanel'
import { ObservationEntry, ParameterDetail, ParameterOverview } from './HealthParameters'
import { useHealthView } from './useHealthView'

/** v3 personal health workspace: registry-driven monitoring, baselines and the care workflow. */
export function HealthWorkspaceView() {
  const view = useHealthView()
  const [selected, setSelected] = useState(registry.parameters.find(p => p.status === 'active')!.id)
  if (!view.subjectId) return <p className="empty-copy">Select a crew member.</p>
  return <div className="stack">
    {view.synthetic && <p className="notice" role="note">Synthetic mission preview: scenario values shown through the v3 parameter model, read-only. Not real health data.</p>}
    <ParameterOverview view={view} selected={selected} onSelect={setSelected} />
    <div className="content-grid">
      <ParameterDetail view={view} parameterId={selected} />
      <div className="stack">
        <ObservationEntry key={`${selected}-${view.subjectId}`} view={view} parameterId={selected} />
        <CarePanel view={view} selectedParameterId={selected} />
      </div>
    </div>
  </div>
}
