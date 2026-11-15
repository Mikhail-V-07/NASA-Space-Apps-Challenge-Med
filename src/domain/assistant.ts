import type { AttentionItem, KnowledgeArticle } from '../../contracts/types'
import { KNOWLEDGE, searchKnowledge, sourceRef } from './knowledge'

/**
 * Assistant architecture (v3.1).
 *
 * The assistant is a PROVIDER behind an interface, separate from the rules engine and clinical
 * workflows: it can explain records and point to sourced knowledge, but it cannot create
 * attention items, record decisions or change data.
 *
 * Shipped providers:
 *  - 'local-knowledge': deterministic keyword retrieval over the sourced knowledge base and the
 *    person's own attention items. No language model is involved.
 *  - 'llm': a stub whose status is 'not_connected'. No model is integrated; calling it returns
 *    a clear refusal. Any future model must pass the same guardrails and cite sources.
 */

export interface AssistantContext { attention: readonly AttentionItem[]; parameterName(id: string): string }
export interface AssistantAnswer { providerId: string; refused: boolean; text: string; citations: { sourceRefId: string; title: string; url: string }[]; articleIds: string[]; limitations: string[] }
export interface AssistantProvider { id: string; label: string; status: 'available' | 'not_connected'; description: string; answer(question: string, ctx: AssistantContext): AssistantAnswer }

const BLOCKED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(diagnos\w*|do i have|what (condition|disease|illness)|is it (cancer|a heart attack|a stroke))\b/i, reason: 'AEGIS does not diagnose. Record the concern and consult the Crew Medical Officer or the ground medical team.' },
  { pattern: /\b(dose|dosage|how (much|many) (mg|ml|tablets?|pills?)|mg\b|should i take|prescri\w*)\b/i, reason: 'AEGIS does not recommend medications or doses. Medication decisions follow the mission’s approved procedures and the medical team.' },
  { pattern: /\b(normal range|is (this|my) .* normal|healthy range|safe level|threshold)\b/i, reason: 'AEGIS contains no approved reference ranges, so it cannot say whether a value is normal. It can show how a value compares with your own baseline.' },
  { pattern: /\b(treat\w*|cure|what should i do about)\b/i, reason: 'AEGIS does not select treatments. It can open a care encounter so the CMO can review.' },
]

export function guardrail(question: string): string | null {
  return BLOCKED.find(b => b.pattern.test(question))?.reason ?? null
}

const cite = (articles: readonly KnowledgeArticle[]) => {
  const ids = [...new Set(articles.flatMap(a => a.points.flatMap(p => p.sourceRefIds)))]
  return ids.map(id => sourceRef(id)).filter((s): s is NonNullable<typeof s> => !!s).map(s => ({ sourceRefId: s.id, title: s.title, url: s.url }))
}

export const localKnowledgeProvider: AssistantProvider = {
  id: 'local-knowledge', label: 'Local knowledge (no AI model)', status: 'available',
  description: 'Keyword retrieval over AEGIS’s sourced knowledge base and your own attention items. Runs offline. Answers are excerpts, not generated advice.',
  answer(question, ctx) {
    const limits = ['Retrieved text from public sources; not personalised medical advice.', 'No language model is used.']
    const blocked = guardrail(question)
    if (blocked) return { providerId: this.id, refused: true, text: blocked, citations: [], articleIds: [], limitations: limits }
    const q = question.toLowerCase()
    const parts: string[] = []
    if (/\b(alert|attention|flag|why)\b/.test(q) && ctx.attention.length) {
      parts.push('Items needing attention in your records:', ...ctx.attention.slice(0, 5).map(a => `• ${a.title}: ${a.explanation}`))
    }
    const articles = searchKnowledge(question, KNOWLEDGE).slice(0, 3)
    for (const a of articles) parts.push(`${a.title}: ${a.summary}`, ...a.points.map(p => `• ${p.text} [${p.sourceRefIds.join(', ')}]`))
    if (!parts.length) return { providerId: this.id, refused: false, text: 'No sourced material matches this question. Try terms such as sleep, bone, exercise, hydration, communication delay or CDSS.', citations: [], articleIds: [], limitations: limits }
    return { providerId: this.id, refused: false, text: parts.join('\n'), citations: cite(articles), articleIds: articles.map(a => a.id), limitations: limits }
  },
}

export const llmProviderStub: AssistantProvider = {
  id: 'llm', label: 'Language model (not connected)', status: 'not_connected',
  description: 'Reserved interface for a future onboard model. Nothing is connected; AEGIS makes no network calls.',
  answer() { return { providerId: 'llm', refused: true, text: 'No language model is connected to AEGIS. Use the local knowledge provider.', citations: [], articleIds: [], limitations: ['Not connected.'] } },
}

export const ASSISTANT_PROVIDERS: AssistantProvider[] = [localKnowledgeProvider, llmProviderStub]
