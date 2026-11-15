import type { KnowledgeArticle, KnowledgeSource } from '../../contracts/types'

/**
 * Medical knowledge layer (v3.1).
 *
 * Every point is a paraphrase of a statement in a listed public source (see the project's source
 * digest). Articles describe context — risks, monitoring practice, system concepts. They contain
 * no diagnostic criteria, thresholds, drugs or doses, and are not clinical guidance.
 */

export const SOURCE_REFERENCES: KnowledgeSource[] = [
  { id: 'nasa-std-3001-v1', title: 'NASA-STD-3001 Vol. 1, §3.0 Health and Medical Care', organization: 'NASA OCHMO', date: 'Rev C, 2023-09-15', url: 'https://www.nasa.gov/reference/3-0-health-and-medical-care/' },
  { id: 'nasa-std-3001-appE', title: 'NASA-STD-3001 Vol. 1, Appendix E (PRA / IMM)', organization: 'NASA OCHMO', date: 'page updated 2026-04-22', url: 'https://www.nasa.gov/reference/appendix-e-health-and-medical-care-technical-requirements/' },
  { id: 'ochmo-fundamentals', title: 'Fundamentals of Human Health (OCHMO technical briefs)', organization: 'NASA OCHMO', date: 'updated 2026-04-21', url: 'https://www.nasa.gov/reference/fundamentals-of-human-health/' },
  { id: 'hrp-hazards', title: 'HRP: Hazards / The Human Body in Space', organization: 'NASA HRP', date: 'updated 2026-05-26', url: 'https://www.nasa.gov/hrp/hazards/' },
  { id: 'hrp-risks', title: 'HRP: Risks', organization: 'NASA HRP', date: 'updated 2026-07-21', url: 'https://www.nasa.gov/hrp/risks/' },
  { id: 'hrp-48033', title: 'ExMC CDSS Concept of Operations (HRP-48033)', organization: 'NASA ExMC', date: '2021 (published 2022)', url: 'https://ntrs.nasa.gov/citations/20220017856' },
  { id: 'russell-2023', title: 'The value of a spaceflight clinical decision support system for EIMO (npj Microgravity 9:46)', organization: 'Russell et al.', date: '2023', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10284846/' },
  { id: 'iws-2025-eimo', title: 'Developing Mars-Based Clinical Scenarios for an EIMO Decision Support Service (IWS 2025)', organization: 'NASA', date: '2025', url: 'https://ntrs.nasa.gov/citations/20240011647' },
  { id: 'imm', title: 'Integrated Medical Model (IMM) overview', organization: 'NASA', date: 'updated 2026-09-16', url: 'https://www.nasa.gov/nasa-integrated-medical-model-imm-overview/' },
  { id: 'jaxa-health', title: 'Health Management for Astronauts', organization: 'JAXA', date: 'accessed 2026-11', url: 'https://humans-in-space.jaxa.jp/en/biz-lab/med-in-space/healthcare/' },
  { id: 'esa-everywear', title: 'EveryWear: from Earth orbit to the Moon', organization: 'ESA', date: '2026-04-06', url: 'https://blogs.esa.int/orion/2026/04/06/everywear-from-earth-orbit-to-the-moon/' },
  { id: 'hrr-gap-med701', title: 'HRR gap Medical-701 (inflight medical capabilities)', organization: 'NASA HRR', date: 'accessed via search snippet', url: 'https://humanresearchroadmap.nasa.gov/gaps/gap.aspx?i=716' },
]

export const sourceRef = (id: string) => SOURCE_REFERENCES.find(s => s.id === id)

const ref = (text: string, ...sourceRefIds: string[]) => ({ text, sourceRefIds })

export const KNOWLEDGE: KnowledgeArticle[] = [
  { id: 'kb-bone', title: 'Bone loss in weightlessness', tags: ['bone', 'musculoskeletal', 'exercise', 'countermeasure'], parameterIds: ['bmd', 'exercise_duration'], status: 'reference',
    summary: 'Weight-bearing bone loses mineral in microgravity; NASA lists bone as an HRP physiology risk.',
    points: [ref('Weight-bearing bone loses roughly 1–1.5% of mineral density per month in spaceflight.', 'hrp-hazards', 'ochmo-fundamentals'), ref('Bone density imaging is among the pre-mission preventive measures in NASA-STD-3001 (V1 3002).', 'nasa-std-3001-v1'), ref('ISS crews exercise at least about 2 hours a day as a countermeasure programme defined by the ground team.', 'jaxa-health')] },
  { id: 'kb-sleep', title: 'Sleep and work/rest schedules', tags: ['sleep', 'fatigue', 'behavioral'], parameterIds: ['sleep_duration', 'fatigue'], status: 'reference',
    summary: 'Sleep and schedule disruption is an HRP behavioral risk; in-mission preventive care includes work/rest and sleep monitoring.',
    points: [ref('NASA-STD-3001 V1 3003 lists work/rest and sleep monitoring among in-mission preventive care areas.', 'nasa-std-3001-v1'), ref('Sleep loss and schedule misalignment appear in the HRP risk list.', 'hrp-risks'), ref('Artemis II studies include wrist actigraphy for activity and sleep (ARCHeR).', 'hrp-hazards')] },
  { id: 'kb-monitoring', title: 'What in-mission care must support', tags: ['monitoring', 'trending', 'records', 'communication'], parameterIds: [], status: 'reference',
    summary: 'The NASA standard requires monitoring, trending, documentation and private data transmission — not a decision-support system.',
    points: [ref('V1 3004 includes trending of vital signs and behavioral health, an encrypted medical record and private transmission of medical data to the ground.', 'nasa-std-3001-v1'), ref('The standard bases care decisions on PRA, clinical guidelines and flight surgeon expertise; it does not name a CDSS.', 'nasa-std-3001-v1')] },
  { id: 'kb-cdss', title: 'Clinical decision support concepts for exploration', tags: ['cdss', 'autonomy', 'cmo', 'eimo'], parameterIds: [], status: 'reference',
    summary: 'NASA CDSS work is at concept/research stage and keeps the Crew Medical Officer in the loop.',
    points: [ref('The ExMC ConOps keeps the CMO "in the loop" for approvals, with ground review when communication allows.', 'hrp-48033'), ref('Envisioned constraints: laptop-class compute, no cloud, no internet.', 'hrp-48033'), ref('The onboard CMO is often a non-physician with about 40 hours of medical training on the ISS.', 'russell-2023'), ref('Clinical numbers in the ConOps scenarios are illustrative and internally inconsistent; they are not protocols.', 'hrp-48033')] },
  { id: 'kb-distance', title: 'Distance from Earth and communication delay', tags: ['communication', 'mars', 'autonomy', 'evacuation'], parameterIds: [], status: 'reference',
    summary: 'Exploration missions lose real-time ground support and resupply.',
    points: [ref('Mars one-way communication delay is up to about 20 minutes, and there is no resupply.', 'hrp-hazards'), ref('An EIMO medical system must cover pre-mission planning, acute and prolonged decision making, automated resource tracking and task-load balancing.', 'iws-2025-eimo')] },
  { id: 'kb-imm', title: 'Integrated Medical Model (planning, not diagnosis)', tags: ['pra', 'planning', 'resources'], parameterIds: [], status: 'reference',
    summary: 'The IMM is a ground-side Monte Carlo PRA tool for mission planning.',
    points: [ref('IMM outputs include total medical events, evacuation probability and resource use.', 'imm'), ref('It is baselined to the ISS and assumes correct diagnosis and effective treatment; it is not an inflight diagnostic tool.', 'imm', 'nasa-std-3001-appE')] },
  { id: 'kb-cardio', title: 'Cardiovascular changes', tags: ['cardiovascular', 'heart rate', 'blood pressure'], parameterIds: ['hr', 'resting_hr', 'sbp', 'dbp'], status: 'reference',
    summary: 'Cardiovascular and cardiorespiratory fitness are HRP physiology risks; ECG and blood pressure capability are part of onboard diagnostics.',
    points: [ref('Cardiovascular and cardiorespiratory/musculoskeletal fitness are on the HRP risk list.', 'hrp-risks'), ref('ISS diagnostics include blood pressure/ECG and respiratory function equipment.', 'jaxa-health')] },
  { id: 'kb-nutrition', title: 'Nutrition and hydration', tags: ['nutrition', 'hydration', 'intake'], parameterIds: ['fluid_intake', 'energy_intake', 'body_mass'], status: 'reference',
    summary: 'Food and nutrition is an HRP risk; nutrition monitoring is an in-mission preventive care area.',
    points: [ref('Periodic health, nutrition and fitness monitoring is listed under V1 3003.', 'nasa-std-3001-v1'), ref('ESA EveryWear lets ISS crews log nutrition and medication.', 'esa-everywear'), ref('Nutrition is one of the HRP-48033 ConOps scenario families.', 'hrp-48033')] },
]

/** Plain keyword search over titles, tags, summaries and points. Deterministic; no ranking model. */
export function searchKnowledge(query: string, articles: readonly KnowledgeArticle[] = KNOWLEDGE): KnowledgeArticle[] {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2)
  if (!terms.length) return []
  const score = (a: KnowledgeArticle) => {
    const hay = [a.title, a.summary, ...a.tags, ...a.points.map(p => p.text)].join(' ').toLowerCase()
    return terms.reduce((n, t) => n + (a.tags.some(g => g.includes(t)) ? 3 : 0) + (hay.includes(t) ? 1 : 0), 0)
  }
  return articles.map(a => ({ a, s: score(a) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s).map(x => x.a)
}
