import { useState, useRef, useEffect, useMemo } from 'react';
import { formatRelativeTime } from '../../utils/formatters';
import { isUserSession } from '../../utils/sessionFilters';
import type { Session } from '../../types/session';

interface RelatedSessionsProps {
  sessions: Session[];
  currentSessionId?: string;
  cwd: string;
  openTabs: string[];
  onSessionClick: (sessionId: string) => void;
}

/** Normalize path for comparison: lowercase, forward slashes, no trailing slash. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function RelatedSessions({ sessions, currentSessionId, cwd, openTabs, onSessionClick }: RelatedSessionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const related = useMemo(() => {
    const normalizedCwd = normalizePath(cwd);
    return sessions
      .filter(s => s.session_id !== currentSessionId && isUserSession(s) && s.cwd && normalizePath(s.cwd) === normalizedCwd)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [sessions, currentSessionId, cwd]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  if (related.length === 0) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-[30px] px-2 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/[0.18] text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800/40 flex items-center gap-1.5 transition-colors duration-150 border border-blue-200/60 dark:border-blue-500/35"
        title={`${related.length} other session${related.length > 1 ? 's' : ''} in this folder`}
      >
        {/* Layers/stack icon */}
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span>{related.length}</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[300px] overflow-y-auto">
          <div className="px-3 py-2 border-b border-white/40 dark:border-gray-700">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Sessions using same project folder</span>
          </div>
          <ul>
            {related.map(session => {
              const isTabOpen = openTabs.includes(session.session_id);
              return (
                <li key={session.session_id}>
                  <button
                    onClick={() => {
                      onSessionClick(session.session_id);
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-white/40 dark:hover:bg-gray-700/40 flex items-center gap-2 transition-colors"
                  >
                    {/* Open tab indicator */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isTabOpen ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{session.session_name}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                      {formatRelativeTime(session.updated_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
