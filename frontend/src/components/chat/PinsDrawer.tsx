import { useState, useRef, useEffect } from 'react';
import { usePinStore } from '../../stores/pinStore';
import { useChatStore } from '../../stores/chatStore';
import { PinnedIcon } from './PinIcons';
import { scrollToMessageBySdkId, formatPinTimestamp, composeAskPrefill, autoResizeTextarea } from '../../utils/chatUtils';

interface PinsDrawerProps {
  sessionId: string;
  pins: { id: string; sdk_message_id: string; created_at: string; title?: string | null; excerpt?: string | null; note?: string | null }[];
  onClose: () => void;
  onAsk?: (prefillText: string) => void;
  focusPinId?: string | null;
  onFocusConsumed?: () => void;
}

export function PinsDrawer({ sessionId, pins, onClose, onAsk, focusPinId, onFocusConsumed }: PinsDrawerProps) {
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [scrollFailedPin, setScrollFailedPin] = useState<string | null>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    setDraftNotes((prev) => {
      const next = { ...prev };
      for (const p of pins) {
        if (next[p.id] === undefined) next[p.id] = p.note ?? '';
      }
      return next;
    });
  }, [pins]);

  useEffect(() => { setConfirmingDelete(null); }, [pins]);

  useEffect(() => {
    for (const el of Object.values(textareaRefs.current)) {
      autoResizeTextarea(el);
    }
  }, [pins]);

  useEffect(() => {
    if (!focusPinId) return;
    const el = textareaRefs.current[focusPinId];
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    onFocusConsumed?.();
  }, [focusPinId, pins, onFocusConsumed]);

  const sortedPins = [...pins].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const handleAsk = (p: typeof pins[0]) => {
    const baseNote = p.note ?? '';
    const note = draftNotes[p.id] ?? baseNote;
    const isDirty = note !== baseNote;

    const savePromise = isDirty
      ? usePinStore.getState().updatePin(sessionId, p.id, { note }).catch((e) => console.error('Failed to save note:', e))
      : Promise.resolve();

    savePromise.then(() => {
      const messages = useChatStore.getState().messagesPerSession[sessionId] || [];
      const fullMsg = messages.find((m) => m.sdk_message_id === p.sdk_message_id);
      const content = fullMsg?.content || p.excerpt || '';
      if (!content) return;
      const prefill = composeAskPrefill(content, note);
      onAsk?.(prefill);
    });
  };

  return (
    <aside data-pins-drawer className="w-96 border-l border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-[#1f1f2e]/90 backdrop-blur p-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><PinnedIcon size={16} /> Pins ({pins.length})</div>
        <button type="button" className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500" onClick={onClose} title="Close">Close</button>
      </div>

      {sortedPins.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">No pins yet.</div>
      ) : (
        <div className="mt-3 space-y-3">
          {sortedPins.map((p) => {
            const baseNote = p.note ?? '';
            const note = draftNotes[p.id] ?? baseNote;
            const isDirty = note !== baseNote;
            const title = p.title || p.excerpt || p.sdk_message_id;

            return (
              <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-[#2a2a3c]/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button" className="flex-1 text-left"
                    onClick={() => {
                      const el = scrollToMessageBySdkId(p.sdk_message_id);
                      if (!el) { setScrollFailedPin(p.id); setTimeout(() => setScrollFailedPin(null), 2000); }
                    }}
                    title={title}
                  >
                    <div className="text-xs text-gray-500 dark:text-gray-400">{formatPinTimestamp(p.created_at)}</div>
                    <div className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline line-clamp-2">{title}</div>
                    {scrollFailedPin === p.id && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Message not available</div>
                    )}
                  </button>
                  {confirmingDelete === p.id ? (
                    <span className="text-xs flex items-center gap-1 whitespace-nowrap">
                      <span className="text-gray-500 dark:text-gray-400">Delete?</span>
                      <button type="button" className="text-red-600 dark:text-red-400 hover:underline" onClick={() => { usePinStore.getState().deletePin(sessionId, p.id).catch((e) => console.error('Failed to unpin:', e)); setConfirmingDelete(null); }}>Yes</button>
                      <span className="text-gray-400 dark:text-gray-500">·</span>
                      <button type="button" className="text-gray-500 dark:text-gray-400 hover:underline" onClick={() => setConfirmingDelete(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 px-1" title="Delete pin" onClick={() => setConfirmingDelete(p.id)}>✕</button>
                  )}
                </div>

                <div className="mt-2">
                  <textarea
                    ref={(el) => { textareaRefs.current[p.id] = el; }}
                    className="w-full text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-[#1f1f2e]/60 px-2 py-1.5 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-y overflow-y-auto"
                    rows={1} style={{ minHeight: '1.75rem', maxHeight: '18.75rem' }}
                    placeholder="Add a note (optional)" value={note}
                    onChange={(e) => { setDraftNotes((prev) => ({ ...prev, [p.id]: e.target.value })); autoResizeTextarea(e.target); }}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button type="button" disabled={!p.excerpt && !p.title}
                      className="text-xs px-2 py-1 rounded border transition-colors border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:border-emerald-300 dark:hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => handleAsk(p)} title="Pre-fill input with this pin's context"
                    >Ask</button>
                    <button type="button" disabled={!isDirty}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${isDirty ? 'border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:border-blue-300 dark:hover:border-blue-500' : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
                      onClick={() => { usePinStore.getState().updatePin(sessionId, p.id, { note }).catch((e) => console.error('Failed to update pin:', e)); }}
                      title="Save note"
                    >Save</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
