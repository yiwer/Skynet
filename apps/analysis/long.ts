import type { AnalysisInput } from '../server/analysis.js';
import type { AnalysisItem, AnalysisOutput, AnalysisPosition, AnalysisProcessing, AnalysisRun } from '../../packages/contracts/analysis.js';
import { analysisOutputSchema } from '../../packages/contracts/analysis.js';

export const SEGMENT_VERSION = 'original-utf16-1';
type Anchor = { event: number; textOffset: number };
export type Stage = { input: AnalysisInput; anchors: Anchor[]; start: AnalysisPosition; end: AnalysisPosition };
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function stageInput(input: AnalysisInput, events: AnalysisInput['events'], phase: 'extract' | 'aggregate'): AnalysisInput {
  return { ...input, events, eventCount: events.length, analysisContext: { phase } };
}
function boundary(text: string, end: number) {
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) return end - 1;
  return end;
}
// Stage anchors refer to immutable input events. Surrogate pairs are never split.
export function planSegments(input: AnalysisInput, config: Pick<AnalysisRun['config'], 'maxInputBytes' | 'maxSegments' | 'maxRequests'>) {
  const stages: Stage[] = []; let eventIndex = 0; let textOffset = 0;
  const limit = Math.min(config.maxSegments, Math.max(1, config.maxRequests - 1));
  while (eventIndex < input.events.length && stages.length < limit) {
    const start = { event: eventIndex, textOffset }; const events: AnalysisInput['events'] = []; const anchors: Anchor[] = [];
    while (eventIndex < input.events.length && events.length < 256) {
      const event = input.events[eventIndex]!; let low = 0; let high = event.text.length - textOffset;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (size(stageInput(input, [...events, { ...event, text: event.text.slice(textOffset, textOffset + middle) }], 'extract')) <= config.maxInputBytes) low = middle; else high = middle - 1;
      }
      const end = boundary(event.text, textOffset + low);
      if (end === textOffset && event.text.length !== textOffset) break;
      const candidate = { ...event, text: event.text.slice(textOffset, end) };
      if (size(stageInput(input, [...events, candidate], 'extract')) > config.maxInputBytes) break;
      anchors.push({ event: eventIndex, textOffset }); events.push(candidate); textOffset = end;
      if (textOffset < event.text.length) break;
      eventIndex++; textOffset = 0;
    }
    if (!events.length) throw new Error('Segment metadata exceeds stage bound; no model call');
    const end = textOffset ? { event: eventIndex, textOffset } : { event: eventIndex - 1, textOffset: input.events[eventIndex - 1]!.text.length };
    stages.push({ input: stageInput(input, events, 'extract'), anchors, start, end });
  }
  const skipped = eventIndex < input.events.length ? { start: { event: eventIndex, textOffset }, end: { event: input.events.length - 1, textOffset: input.events.at(-1)!.text.length }, state: 'skipped' as const, reason: '段数或全任务请求限额' } : undefined;
  return { stages, skipped };
}
export function mapOutput(stage: Stage, value: unknown): AnalysisOutput {
  const output = analysisOutputSchema.parse(value);
  return { items: output.items.map(item => ({ ...item, citations: item.citations.map(citation => {
    const anchor = stage.anchors[citation.event]; const event = stage.input.events[citation.event];
    if (!anchor || !event || event.text.slice(citation.textOffset, citation.textOffset + citation.quote.length) !== citation.quote) throw new Error('Citation outside selected original segment');
    return { ...citation, event: anchor.event, textOffset: anchor.textOffset + citation.textOffset };
  }) })) };
}
const citationKey = (citation: AnalysisOutput['items'][number]['citations'][number]) => JSON.stringify([citation.event, citation.textOffset, citation.quote]);
export function planAggregation(input: AnalysisInput, items: AnalysisItem[], maxBytes: number) {
  const events: AnalysisInput['events'] = []; const anchors: Anchor[] = []; const allowed = new Set<string>();
  let omittedFindings = 0; const findings: NonNullable<AnalysisInput['analysisContext']>['findings'] = [];
  for (const item of items) {
    if (!item.citations.length) { omittedFindings++; continue; }
    const additions = item.citations.filter(citation => !allowed.has(citationKey(citation)));
    const proposed = [...events, ...additions.map(citation => ({ ...input.events[citation.event]!, text: citation.quote }))];
    const proposedFindings = [...findings, { text: item.text, category: item.category, assessment: item.assessment }];
    const candidate = { ...stageInput(input, proposed, 'aggregate'), analysisContext: { phase: 'aggregate' as const, findings: proposedFindings } };
    if (proposed.length > 256 || size(candidate) > maxBytes) { omittedFindings++; continue; }
    findings.push(proposedFindings.at(-1)!);
    for (const citation of additions) { allowed.add(citationKey(citation)); events.push({ ...input.events[citation.event]!, text: citation.quote }); anchors.push({ event: citation.event, textOffset: citation.textOffset }); }
  }
  return { stage: { input: { ...stageInput(input, events, 'aggregate'), analysisContext: { phase: 'aggregate' as const, findings } }, anchors, start: { event: 0, textOffset: 0 }, end: { event: 0, textOffset: 0 } }, allowed, omittedFindings };
}
export function validateAggregate(stage: Stage, value: unknown, allowed: Set<string>) {
  const mapped = mapOutput(stage, value);
  for (const item of mapped.items) for (const citation of item.citations) if (!allowed.has(citationKey(citation))) throw new Error('Aggregation citation was not a validated original quote');
  return mapped;
}
export function initialProcessing(): AnalysisProcessing {
  return { version: SEGMENT_VERSION, complete: false, aggregation: 'not-needed', omittedFindings: 0, ranges: [] };
}
