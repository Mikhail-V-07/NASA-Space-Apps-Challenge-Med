import { useMemo } from 'react'
import type { AnalysisRule, AttentionItem, DataOrigin, HealthWorkspace, MissionProfile } from '../../../contracts/types'
import { useAppState } from '../../app/state/context'
import { activeWorkspace, actorFor, missionProfileOf, scopeNow } from '../../app/state/reducer'
import type { SimulationState } from '../../app/state/reducer'
import { emptyWorkspace, evaluateRules, registry, visibleTo } from '../../domain'
import type { HealthCommand } from '../../domain'

export interface HealthView {
  /** Records visible in the current context for the selected subject (shared inventory included). */
  workspace: HealthWorkspace
  subjectId: string | null
  role: 'astronaut' | 'medical' | 'mission'
  /** Mission Overview is read-only for health records. */
  readOnly: boolean
  synthetic: boolean
  origin: DataOrigin
  /** Wall clock for observed data; simulator clock for synthetic data. */
  now: string
  mission: MissionProfile
  rules: AnalysisRule[]
  /** Items needing attention for the selected subject, from the configured rules. */
  attention: AttentionItem[]
  sim: SimulationState
  crew: { id: string; displayName: string }[]
  send(command: HealthCommand): void
}

export function useHealthView(): HealthView {
  const { state, dispatch } = useAppState()
  const subjectId = state.selectedAstronautId
  const synthetic = state.scope === 'synthetic'
  const origin: DataOrigin = synthetic ? 'synthetic' : 'observed'
  const now = scopeNow(state)
  const mission = missionProfileOf(state)
  const full = activeWorkspace(state)
  const workspace = useMemo<HealthWorkspace>(() => {
    if (state.mode === 'mission' && !synthetic) return emptyWorkspace()
    const visible = state.mode === 'mission' ? full : visibleTo(full, actorFor(state))
    const own = <T extends { subjectId: string }>(xs: T[]) => xs.filter(x => x.subjectId === subjectId)
    const encIds = new Set(own(visible.encounters).map(e => e.id))
    const byEnc = <T extends { encounterId: string }>(xs: T[]) => xs.filter(x => encIds.has(x.encounterId))
    return {
      ...visible, observations: own(visible.observations), baselines: own(visible.baselines), encounters: own(visible.encounters), interventions: own(visible.interventions),
      profile: own(visible.profile), plans: own(visible.plans), completions: own(visible.completions), intakes: byEnc(visible.intakes), findings: byEnc(visible.findings),
      protocolRuns: byEnc(visible.protocolRuns), decisions: byEnc(visible.decisions), messages: own(visible.messages), resourceUses: own(visible.resourceUses),
      attention: visible.attention.filter(a => a.itemId.split(':')[1] === subjectId),
    }
  }, [full, state.mode, state.sessionAstronautId, subjectId, synthetic])
  const attention = useMemo(() => subjectId ? evaluateRules(state.rules, workspace, [subjectId], origin, now, registry) : [], [state.rules, workspace, subjectId, origin, now])
  return {
    workspace, subjectId, role: state.mode, synthetic, origin, now, mission, rules: state.rules, attention, sim: state.sim,
    crew: state.mission.crew.filter(c => state.mode !== 'astronaut' || c.id === state.sessionAstronautId).map(c => ({ id: c.id, displayName: c.displayName })),
    readOnly: state.mode === 'mission',
    send: command => dispatch({ type: 'health/command', command }),
  }
}
