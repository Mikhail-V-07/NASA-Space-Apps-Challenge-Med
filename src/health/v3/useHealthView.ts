import { useMemo } from 'react'
import type { HealthWorkspace } from '../../../contracts/types'
import { useAppState } from '../../app/state/context'
import { actorFor } from '../../app/state/reducer'
import { emptyWorkspace, fromLegacyAll, visibleTo } from '../../domain'
import type { HealthCommand } from '../../domain'

export interface HealthView {
  /** Records visible in the current context for the selected subject. */
  workspace: HealthWorkspace
  subjectId: string | null
  role: 'astronaut' | 'medical' | 'mission'
  /** Synthetic preview and Mission Overview are read-only for health records. */
  readOnly: boolean
  synthetic: boolean
  send(command: HealthCommand): void
}

export function useHealthView(): HealthView {
  const { state, dispatch } = useAppState()
  const subjectId = state.selectedAstronautId
  const workspace = useMemo<HealthWorkspace>(() => {
    if (state.scope === 'synthetic') {
      // Synthetic scenario data is shown through the v3 model, read-only, never mixed with observed records.
      const observations = fromLegacyAll(state.mission.measurements).filter(o => o.subjectId === subjectId)
      return { ...emptyWorkspace(), observations }
    }
    if (state.mode === 'mission') return emptyWorkspace()
    const visible = visibleTo(state.health, actorFor(state))
    const own = <T extends { subjectId: string }>(xs: T[]) => xs.filter(x => x.subjectId === subjectId)
    return { ...visible, observations: own(visible.observations), baselines: own(visible.baselines), encounters: own(visible.encounters), interventions: own(visible.interventions) }
  }, [state, subjectId])
  return {
    workspace, subjectId, role: state.mode, synthetic: state.scope === 'synthetic',
    readOnly: state.scope !== 'observed' || state.mode === 'mission',
    send: command => dispatch({ type: 'health/command', command }),
  }
}
