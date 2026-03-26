import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { mobileApiClient, getApiBase, getHeaders } from '../mobileClient';
import { formatRelativeTime } from '../../utils/formatters';
import { SSE_EVENTS } from '../../utils/sseConstants';
import { useSessionStore } from '../../stores/sessionStore';
import { useViewedStore } from '../../stores/viewedStore';
import type { Session } from '../../types/session';

interface ActiveAgentsResponse {
  count: number;
  sessions: { session_id: string; elapsed_seconds: number; current_step?: string }[];
}

interface Props {
  onNotification: (n: { message: string; sessionId?: string } | null) => void;
}

export function MobileSessionList({ onNotification }: Props) {
  const navigate = useNavigate();
  const sessions = useSessionStore(s => s.sessions);
  const setSessions = useSessionStore(s => s.setSessions);
  const viewedStore = useViewedStore();
  const activeAgents = useViewedStore(s => s.activeAgents);
  const setActiveAgentIds = useViewedStore(s => s.setActiveAgentIds);
  const [loading, setLoading] = useState(!sessions.length);
  const [refreshing, setRefreshing] = useState(false);

  // Full data reload — only for first boot and explicit refresh
  const loadData = useCallback(async () => {
    try {
      const [sessionsData, viewedData, activeData] = await Promise.all([
        mobileApiClient.get<{ sessions: Session[] }>('/sessions'),
        mobileApiClient.get<Record<string, number>>('/viewed'),
        mobileApiClient.get<ActiveAgentsResponse>('/sessions/active-agents'),
      ]);
      const filtered = sessionsData.sessions.filter(s => s.trigger !== 'automation');
      setSessions(filtered);
      // Merge viewed timestamps: keep the more recent of in-memory vs backend
      const currentViewed = useViewedStore.getState().lastViewed;
      const merged: Record<string, number> = { ...viewedData };
      for (const [sid, ts] of Object.entries(currentViewed)) {
        if (!merged[sid] || ts > merged[sid]) {
          merged[sid] = ts;
        }
      }
      useViewedStore.setState({ lastViewed: merged, isLoaded: true });
      setActiveAgentIds(new Set(activeData.sessions.map(s => s.session_id)));
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setSessions, setActiveAgentIds]);

  // First boot only — subsequent navigations use cached stores
  useEffect(() => {
    if (sessions.length > 0) {
      // Already have data in stores — mark loaded immediately, skip fetch
      useViewedStore.setState({ isLoaded: true });
      return;
    }
    loadData();
  }, []);

  // Stable refs for SSE handlers
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  // SSE for active agent updates — fetch-based for reliable auth on mobile
  const sseBackoffRef = useRef(2000);

  useEffect(() => {
    let abortController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function connect() {
      if (cancelled) return;
      abortController = new AbortController();
      sseBackoffRef.current = 2000;

      try {
        const response = await fetch(`${getApiBase()}/sessions/active-agents/stream`, {
          headers: getHeaders(),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const events = sseBuffer.split(/\r?\n\r?\n/);
          sseBuffer = events.pop() || '';

          for (const event of events) {
            const lines = event.split(/\r?\n/);
            let eventName = '';
            let eventData = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.replace(/^event:\s?/, '').trim();
              else if (line.startsWith('data:')) eventData = line.replace(/^data:\s?/, '');
            }
            if (!eventData) continue;
            try {
              const data = JSON.parse(eventData);
              if (eventName === SSE_EVENTS.COMPLETED) {
                const sid = data.session_id;
                // Update stores — spinner → blue dot transition
                useViewedStore.getState().setAgentActive(sid, false);
                // Use server completion timestamp if available (same clock as viewed.json)
                if (data.updated_at) {
                  const iso = new Date(data.updated_at * 1000).toISOString();
                  useSessionStore.getState().setSessions(
                    useSessionStore.getState().sessions.map(s =>
                      s.session_id === sid ? { ...s, updated_at: iso } : s
                    )
                  );
                } else {
                  useSessionStore.getState().updateSessionTimestamp(sid);
                }
                const session = sessionsRef.current.find(s => s.session_id === sid);
                onNotificationRef.current({
                  message: `Agent finished: ${session?.session_name || 'Session'}`,
                  sessionId: sid,
                });
              } else if (eventName === SSE_EVENTS.UPDATE) {
                const currentIds = new Set<string>(
                  data.sessions.map((s: { session_id: string }) => s.session_id)
                );
                useViewedStore.getState().setActiveAgentIds(currentIds);
                sseBackoffRef.current = 2000;
              }
            } catch { /* skip malformed event */ }
          }
        }
      } catch {
        // Connection lost — reconnect with backoff
      }

      if (!cancelled) {
        reconnectTimer = setTimeout(connect, sseBackoffRef.current);
        sseBackoffRef.current = Math.min(sseBackoffRef.current * 2, 30000);
      }
    }

    connect();

    return () => {
      cancelled = true;
      abortController?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const isUnread = (session: Session): boolean => {
    return viewedStore.hasUnread(session.session_id, session.updated_at, session.created_at);
  };

  const handleSessionClick = async (sessionId: string) => {
    viewedStore.markViewed(sessionId);
    navigate(`/mobile/chat/${sessionId}`);
  };

  // Pull-to-refresh
  const listRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const isPulling = useRef(false);
  const PULL_THRESHOLD = 60;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = listRef.current;
    if (el && el.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.5, 100));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (pullDistance > PULL_THRESHOLD && !refreshing) {
      handleRefresh();
    }
    setPullDistance(0);
    isPulling.current = false;
  }, [pullDistance, refreshing]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 bg-white dark:bg-[#252536] border-b border-gray-200 dark:border-[#3a3a4e]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sessions</h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-gray-500 dark:text-gray-400 p-2"
          >
            <svg className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list with pull-to-refresh */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Pull indicator */}
        {pullDistance > 0 && (
          <div className="flex justify-center py-2" style={{ height: pullDistance }}>
            <svg
              className={`w-6 h-6 text-gray-400 transition-transform ${pullDistance > PULL_THRESHOLD ? 'text-blue-500' : ''}`}
              style={{ transform: `rotate(${Math.min(pullDistance / PULL_THRESHOLD, 1) * 180}deg)` }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        )}
        {refreshing && pullDistance === 0 && (
          <div className="flex justify-center py-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        )}
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <p>No sessions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-[#3a3a4e]">
            {sessions.map(session => {
              const unread = isUnread(session);
              const isActive = activeAgents.has(session.session_id);
              return (
                <button
                  key={session.session_id}
                  onClick={() => handleSessionClick(session.session_id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-[#2a2a3c] active:bg-gray-100 dark:active:bg-[#32324a] transition-colors"
                >
                  {/* Status indicator — mutually exclusive: spinner > blue dot > empty (same as desktop) */}
                  <div className="w-3 flex-shrink-0 flex items-center justify-center">
                    {isActive ? (
                      <svg className="w-3 h-3 text-emerald-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : unread ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                    ) : null}
                  </div>

                  {/* Session info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${unread && !isActive ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                        {session.session_name}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {session.model} · {formatRelativeTime(session.updated_at)}
                    </div>
                  </div>

                  {/* Chevron */}
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
