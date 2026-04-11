/**
 * Shared step parsing logic for desktop and mobile.
 * 
 * Parses raw ChatStep[] into structured ParsedStep[] with merged tool calls,
 * ask_user Q&A pairs, and elicitation responses.
 */

import type { ChatStep } from '../types/message';

export type ParsedStep =
  | { type: 'regular'; title: string; detail?: string }
  | { type: 'ask_user'; question: string; answer: string }
  | { type: 'elicitation'; message: string; response: string };

/**
 * Parse raw steps into structured entries:
 * - Merges Tool start + Tool done into single entries
 * - Extracts ask_user/elicitation Q&A pairs
 * - Filters out report_intent noise
 */
export function parseSteps(steps: ChatStep[]): ParsedStep[] {
  const parsed: ParsedStep[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < steps.length; i++) {
    if (consumed.has(i)) continue;
    const s = steps[i];

    // Skip report_intent — noise
    if (s.title === 'Tool: report_intent' || s.title?.includes('report_intent')) {
      consumed.add(i);
      // Also consume its matching "done"
      const idMatch = s.detail?.match(/^id=(\S+)/);
      if (idMatch) {
        for (let j = i + 1; j < steps.length; j++) {
          if (!consumed.has(j) && steps[j].detail?.includes(idMatch[1])) {
            consumed.add(j);
            break;
          }
        }
      }
      continue;
    }

    // Parse ask_user / elicitation tool pairs
    if (s.title === 'Tool: ask_user' || s.title === 'Tool: elicitation') {
      let question = '';
      let toolId = '';
      if (s.detail) {
        const idMatch = s.detail.match(/^id=(\S+)/);
        if (idMatch) toolId = idMatch[1];
        const inputMatch = s.detail.match(/Input:\s*(\{[\s\S]*\})/);
        if (inputMatch) {
          try {
            const input = JSON.parse(inputMatch[1]);
            question = input.question || input.message || '';
          } catch { /* ignore */ }
        }
      }
      let answer = '';
      if (toolId) {
        for (let j = i + 1; j < steps.length; j++) {
          if (consumed.has(j)) continue;
          const done = steps[j];
          if ((done.title === 'Tool done' || done.title?.startsWith('Tool done:')) && done.detail?.includes(toolId)) {
            const respMatch = done.detail.match(/User responded:\s*(.+?)(?:',|$)/);
            const selMatch = done.detail.match(/User selected:\s*(.+?)(?:',|$)/);
            const contentMatch = done.detail.match(/content='([^']*?)'/);
            answer = respMatch?.[1] || selMatch?.[1] || contentMatch?.[1] || '';
            answer = answer.replace(/['"]$/, '').trim();
            consumed.add(j);
            break;
          }
        }
      }
      consumed.add(i);
      if (question) {
        parsed.push(s.title === 'Tool: ask_user'
          ? { type: 'ask_user', question, answer: answer || '(no response)' }
          : { type: 'elicitation', message: question, response: answer || '(no response)' });
        continue;
      }
    }

    // Merge Tool start + Tool done into single entry
    if (s.title?.startsWith('Tool: ')) {
      const toolName = s.title.replace('Tool: ', '');
      let toolId = '';
      let inputSummary = '';
      if (s.detail) {
        const idMatch = s.detail.match(/^id=(\S+)/);
        if (idMatch) toolId = idMatch[1];
        // Extract a short summary from input
        const inputMatch = s.detail.match(/Input:\s*(.+)/);
        if (inputMatch) {
          inputSummary = inputMatch[1].slice(0, 120);
          // Try to extract key args (file paths, patterns, etc.)
          try {
            const input = JSON.parse(inputMatch[1]);
            const path = input.path || input.file || input.filePath || '';
            const pattern = input.pattern || input.query || '';
            if (path && pattern) inputSummary = `${pattern} in ${path}`;
            else if (path) inputSummary = path;
            else if (pattern) inputSummary = pattern;
          } catch { /* use raw summary */ }
        }
      }
      // Find matching done step
      let result = '';
      if (toolId) {
        for (let j = i + 1; j < steps.length; j++) {
          if (consumed.has(j)) continue;
          const done = steps[j];
          if ((done.title === 'Tool done' || done.title?.startsWith('Tool done:')) && done.detail?.includes(toolId)) {
            consumed.add(j);
            // Extract short result if available
            if (done.detail) {
              const outputMatch = done.detail.match(/Output:\s*(.+)/);
              if (outputMatch) result = outputMatch[1].slice(0, 80);
            }
            break;
          }
        }
      }
      consumed.add(i);
      const title = inputSummary ? `${toolName} ${inputSummary}` : toolName;
      parsed.push({ type: 'regular', title, detail: result || undefined });
      continue;
    }

    // Skip standalone "Tool done" that wasn't consumed (orphans)
    if (s.title === 'Tool done' || s.title?.startsWith('Tool done:')) {
      consumed.add(i);
      continue;
    }

    // Regular step
    consumed.add(i);
    parsed.push({ type: 'regular', title: s.title, detail: s.detail });
  }

  return parsed;
}

/** Count user input steps. */
export function countUserInputs(parsed: ParsedStep[]): number {
  return parsed.filter(p => p.type === 'ask_user' || p.type === 'elicitation').length;
}
