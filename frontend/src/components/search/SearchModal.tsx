import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { searchSessions, type SearchResult, type SearchSnippet } from '../../api/search';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { openSessionTab } from '../../utils/openSession';
import { scrollToMessageBySdkId } from '../chat/ChatPane';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FilterMode = 'chats' | 'all';
const FILTER_MODE_KEY = 'copilot.search.filterMode';
const HIDDEN_TRIGGERS = new Set(['workflow', 'automation', 'help']);

function isChatResult(r: SearchResult): boolean {
  return !r.trigger || !HIDDEN_TRIGGERS.has(r.trigger);
}

function triggerBadge(trigger: string | null | undefined): { icon: string; label: string } | null {
  if (!trigger) return null;
  if (trigger === 'workflow') return { icon: '🔀', label: 'Workflow' };
  if (trigger === 'automation') return { icon: '⏰', label: 'Automation' };
  if (trigger === 'help') return { icon: '❓', label: 'Help' };
  return null;
}

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>(() => {
    try {
      const stored = localStorage.getItem(FILTER_MODE_KEY);
      return stored === 'all' ? 'all' : 'chats';
    } catch {
      return 'chats';
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { sessions } = useSessionStore();

  // Persist filter mode
  useEffect(() => {
    try { localStorage.setItem(FILTER_MODE_KEY, filterMode); } catch { /* ignore */ }
  }, [filterMode]);

  // Counts + filtered list
  const chatsCount = useMemo(() => results.filter(isChatResult).length, [results]);
  const allCount = results.length;
  const filteredResults = useMemo(
    () => (filterMode === 'chats' ? results.filter(isChatResult) : results),
    [results, filterMode],
  );

  // Reset selected index when filter or results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filterMode, results]);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Document-level Escape handler (works even when input is focused)
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Also remove setSelectedIndex(0) from search effect — it's handled by the
  // results-change effect above (avoid stale-closure double reset).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchSessions(query);
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Build flat list of clickable items for keyboard nav
  const flatItems = useCallback((): Array<{ result: SearchResult; snippet?: SearchSnippet }> => {
    const items: Array<{ result: SearchResult; snippet?: SearchSnippet }> = [];
    for (const r of filteredResults) {
      if (r.snippets.length === 0) {
        items.push({ result: r });
      } else {
        for (const s of r.snippets) {
          items.push({ result: r, snippet: s });
        }
      }
    }
    return items;
  }, [filteredResults]);

  const handleSelect = useCallback(async (result: SearchResult, snippet?: SearchSnippet) => {
    const currentQuery = query;
    onClose();

    // Find session in store
    const session = sessions.find(s => s.session_id === result.session_id);
    if (!session) return;

    // Set search highlight term early so it's ready when messages render
    if (currentQuery) {
      useUIStore.getState().setSearchHighlight(currentQuery);
    }

    // Use the shared session opener (same as SessionItem click)
    await openSessionTab(session);

    // Scroll to matching message and flash-highlight it
    if (snippet?.sdk_message_id || snippet?.content) {
      setTimeout(() => {
        const el = scrollToMessageBySdkId(
          snippet.sdk_message_id || '',
          snippet.content,
        );
        if (el) {
          el.classList.add('search-highlight');
          setTimeout(() => el.classList.remove('search-highlight'), 5000);
        }
        // Clear keyword highlights 5s after scroll (not from click time)
        setTimeout(() => useUIStore.getState().setSearchHighlight(null), 5000);
      }, 400);
    } else {
      // No snippet to scroll to — clear highlight after 5s from now
      setTimeout(() => useUIStore.getState().setSearchHighlight(null), 5000);
    }
  }, [onClose, sessions]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const items = flatItems();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && items.length > 0) {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) handleSelect(item.result, item.snippet);
    }
  }, [flatItems, selectedIndex, handleSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-search-idx="${selectedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Search panel */}
      <div className="relative bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-[#3a3a4e] rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[60vh] flex flex-col">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-[#3a3a4e]">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search across all sessions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          />
          {loading && (
            <svg className="w-4 h-4 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-[#1e1e2e] rounded border border-gray-200 dark:border-[#3a3a4e]">ESC</kbd>
          <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#3a3a4e] transition-colors" title="Close (Esc)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="overflow-y-auto flex-1 min-h-0">
          {query.length > 0 && query.length < 2 && !loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">Type 2 or more characters to search</div>
          )}
          {query.length >= 2 && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No results found</div>
          )}
          {query.length >= 2 && !loading && results.length > 0 && filteredResults.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No chat matches —{' '}
              <button
                onClick={() => setFilterMode('all')}
                className="underline hover:text-gray-600 dark:hover:text-gray-200"
              >
                switch to All
              </button>
              {' '}to see {allCount} other result{allCount === 1 ? '' : 's'}
            </div>
          )}
          {filteredResults.length > 0 && (() => {
            // Pre-compute flat index for each renderable item
            let globalIdx = 0;
            return filteredResults.map((result) => {
              const badge = triggerBadge(result.trigger);
              if (result.snippets.length === 0) {
                const idx = globalIdx++;
                return (
                  <div key={result.session_id} className="border-b border-gray-100 dark:border-[#3a3a4e]/50 last:border-b-0">
                    <button
                      data-search-idx={idx}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors ${
                        selectedIndex === idx
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-[#32324a]'
                      }`}
                      onClick={() => handleSelect(result)}
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{result.session_name}</span>
                      {badge && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#3a3a4e] text-gray-500 dark:text-gray-400 flex-shrink-0"
                          title={badge.label}
                        >
                          {badge.icon} {badge.label}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{formatTimeAgo(result.last_active)}</span>
                    </button>
                  </div>
                );
              }
              // Session with snippets
              const snippetIndices = result.snippets.map(() => globalIdx++);
              return (
                <div key={result.session_id} className="border-b border-gray-100 dark:border-[#3a3a4e]/50 last:border-b-0">
                  <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{result.session_name}</span>
                    {badge && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#3a3a4e] text-gray-500 dark:text-gray-400 flex-shrink-0"
                        title={badge.label}
                      >
                        {badge.icon} {badge.label}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{formatTimeAgo(result.last_active)}</span>
                  </div>
                  {result.snippets.map((snippet, si) => (
                    <button
                      key={si}
                      data-search-idx={snippetIndices[si]}
                      className={`w-full text-left px-4 py-1.5 pl-10 flex items-start gap-2 transition-colors ${
                        selectedIndex === snippetIndices[si]
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-[#32324a]'
                      }`}
                      onClick={() => handleSelect(result, snippet)}
                    >
                      <span className={`text-[10px] font-medium px-1 py-0.5 rounded flex-shrink-0 mt-0.5 ${
                        snippet.message_role === 'user'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      }`}>
                        {snippet.message_role === 'user' ? 'You' : 'AI'}
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 flex-1">{snippet.content}</span>
                    </button>
                  ))}
                </div>
              );
            });
          })()}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-[#3a3a4e]/50 flex items-center gap-3 text-[10px] text-gray-400">
            <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[#1e1e2e] rounded text-[10px] border border-gray-200 dark:border-[#3a3a4e]">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[#1e1e2e] rounded text-[10px] border border-gray-200 dark:border-[#3a3a4e]">↵</kbd> open</span>
            <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[#1e1e2e] rounded text-[10px] border border-gray-200 dark:border-[#3a3a4e]">esc</kbd> close</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setFilterMode('chats')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  filterMode === 'chats'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-[#3a3a4e]'
                }`}
                title="Show only chat sessions"
              >
                Chats ({chatsCount})
              </button>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <button
                onClick={() => setFilterMode('all')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  filterMode === 'all'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-[#3a3a4e]'
                }`}
                title="Include workflow, automation, and help sessions"
              >
                All ({allCount})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
