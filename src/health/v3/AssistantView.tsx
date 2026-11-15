import { useState } from 'react'
import { Panel } from '../../app/components/Panel'
import { ASSISTANT_PROVIDERS, KNOWLEDGE, registry, sourceRef } from '../../domain'
import type { AssistantAnswer } from '../../domain'
import type { HealthView } from './useHealthView'

export function AssistantView({ view }: { view: HealthView }) {
  const [providerId, setProviderId] = useState('local-knowledge'), [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: AssistantAnswer }[]>([])
  const provider = ASSISTANT_PROVIDERS.find(p => p.id === providerId)!
  return <div className="content-grid">
    <Panel title="Assistant" eyebrow={provider.label}>
      <div className="control-row" role="group" aria-label="Assistant provider">{ASSISTANT_PROVIDERS.map(p => <label key={p.id} className="check-label"><input type="radio" name="provider" checked={p.id === providerId} onChange={() => setProviderId(p.id)} />{p.label} <span className={p.status === 'available' ? 'badge neutral' : 'badge'}>{p.status.replace('_', ' ')}</span></label>)}</div>
      <p className="muted">{provider.description}</p>
      <form className="control-row" onSubmit={e => { e.preventDefault(); if (!q.trim()) return; setLog([{ q, a: provider.answer(q, { attention: view.attention, parameterName: id => registry.parameter(id)?.displayName ?? id }) }, ...log].slice(0, 10)); setQ('') }}>
        <label className="field">Ask about sources, your records or the system<input value={q} maxLength={500} onChange={e => setQ(e.target.value)} placeholder="e.g. why is something flagged? what does NASA say about sleep?" /></label>
        <button className="button primary">Ask</button>
      </form>
      {log.map((x, i) => <article key={i} className="follow-up assistant-answer" aria-label="Assistant answer">
        <p><strong>Q:</strong> {x.q}</p>
        {x.a.refused ? <p role="note" className="notice">{x.a.text}</p> : <pre className="message-body">{x.a.text}</pre>}
        {x.a.citations.length > 0 && <ul className="plain-list">{x.a.citations.map(c => <li key={c.sourceRefId}><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> <span className="mono muted">[{c.sourceRefId}]</span></li>)}</ul>}
        <p className="sample-note">{x.a.limitations.join(' ')}</p>
      </article>)}
      <p className="sample-note">The assistant is separate from the rules engine and from care records: it cannot flag, decide or change anything. It refuses diagnosis, medication/dose and “is this normal” questions.</p>
    </Panel>
    <Panel title="Knowledge base" eyebrow={`${KNOWLEDGE.length} sourced articles`}>
      {KNOWLEDGE.map(a => <details key={a.id} className="kb-article"><summary><strong>{a.title}</strong> <span className="muted">· {a.status}</span></summary>
        <p>{a.summary}</p>
        <ul className="plain-list">{a.points.map((p, i) => <li key={i}>{p.text} <span className="muted">— {p.sourceRefIds.map(id => sourceRef(id)?.organization ?? id).join(', ')}</span></li>)}</ul>
      </details>)}
      <p className="sample-note">Paraphrased context from public NASA, ESA and JAXA sources. Not clinical guidance.</p>
    </Panel>
  </div>
}
