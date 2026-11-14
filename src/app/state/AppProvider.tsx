import { useEffect, useMemo, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { AppContext } from './context'
import { actorFor, appReducer, createAppState, selectWorkspace } from './reducer'
import { visibleTo } from '../../domain'
import { persistState, restoreState, STORAGE_KEY } from './persistence'

function initialize() {
  try { const result = restoreState(localStorage); return { initial: result.state ?? createAppState(), error: result.error } }
  catch { return { initial: createAppState(), error: 'Browser storage unavailable. Records cannot yet be saved.' } }
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [restored] = useState(initialize)
  const [state, dispatch] = useReducer(appReducer, restored.initial)
  const [storageError, setStorageError] = useState<string | null>(restored.error)
  const [blocked, setBlocked] = useState(Boolean(restored.error))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (state.mission.paused) return
    let last = performance.now()
    const timer = window.setInterval(() => { const now = performance.now(); const elapsed = Math.min((now - last) / 1000, 60); last = now; dispatch({ type: 'mission/tick', seconds: elapsed * state.mission.speed }) }, 1000)
    return () => window.clearInterval(timer)
  }, [state.mission.paused, state.mission.speed])
  useEffect(() => {
    if (blocked) return
    try { persistState(localStorage, state) }
    catch { queueMicrotask(() => setStorageError('Saving failed. Your in-memory records are still available. Download a backup and free browser storage, then retry.')) }
  }, [state, blocked, revision])
  const value = useMemo(() => ({ state, dispatch }), [state])
  function downloadBackup() {
    if (blocked && state.mode !== 'medical') return
    const raw = blocked ? localStorage.getItem(STORAGE_KEY) : state.mode === 'medical' ? JSON.stringify({ version: 3, state }, null, 2) : JSON.stringify({ version: 3, workspace: selectWorkspace(state), health: state.mode === 'mission' ? null : visibleTo(state.health, actorFor(state)), exportType: 'scoped-records' }, null, 2)
    const url = URL.createObjectURL(new Blob([raw ?? '{}'], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'aegis-local-backup.json'; a.click(); URL.revokeObjectURL(url)
  }
  return <AppContext.Provider value={value}>
    {storageError && <div className="storage-warning" role="alert"><p>{storageError}</p>{blocked && state.mode !== 'medical' && <p>Raw recovery export is available in the Medical Officer demo context only; unvalidated records cannot be safely filtered by subject.</p>}<button className="button" disabled={blocked && state.mode !== 'medical'} onClick={downloadBackup}>{state.mode === 'medical' ? 'Download all saved sandbox data' : 'Download my workspace records'}</button><button className="button" onClick={() => { if (!blocked || window.confirm('Replace incompatible saved data with the current workspace? Download a backup first.')) { setBlocked(false); setStorageError(null); setRevision(r => r + 1) } }}>{blocked ? 'Replace saved data' : 'Retry saving'}</button></div>}
    {children}
  </AppContext.Provider>
}
