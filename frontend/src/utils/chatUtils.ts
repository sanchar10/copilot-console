/**
 * Utility functions extracted from ChatPane for reuse and testability.
 */

/**
 * Scroll a message element into view by its SDK message ID.
 * Falls back to scanning message text content if the exact ID isn't found.
 */
export function scrollToMessageBySdkId(mid: string, fallbackContent?: string): HTMLElement | null {
  const esc = (window as any).CSS?.escape ? (window as any).CSS.escape(mid) : mid.replace(/"/g, '\\"');
  let el = document.querySelector(`[data-sdk-message-id="${esc}"]`) as HTMLElement | null;

  if (!el && fallbackContent) {
    const needle = fallbackContent.toLowerCase();
    const candidates = document.querySelectorAll('[data-sdk-message-id]');
    for (const node of candidates) {
      if ((node as HTMLElement).textContent?.toLowerCase().includes(needle)) {
        el = node as HTMLElement;
        break;
      }
    }
  }

  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return el;
}

/** Format a pin timestamp for display. */
export function formatPinTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

/** Compose the pre-fill text for the [Ask] button. */
export function composeAskPrefill(messageContent: string, note: string): string {
  const truncated = messageContent.slice(0, 500);
  const quoted = truncated
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
  const suffix = messageContent.length > 500 ? '\n> ...' : '';
  const noteSection = note.trim() ? `\n\n${note.trim()}` : '\n\n';
  return `Following up on your earlier response:\n\n${quoted}${suffix}${noteSection}`;
}

/** Auto-resize a textarea up to a max height (5 lines ≈ 120px). */
export function autoResizeTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}
