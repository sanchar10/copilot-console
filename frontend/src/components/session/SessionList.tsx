import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTabStore } from '../../stores/tabStore';
import type { Session } from '../../types/session';
import { SessionItem } from './SessionItem';

interface SessionListProps {
  sessions: Session[];
}

// Estimated height of each session item (adjust if needed)
const ITEM_HEIGHT = 56;

export function SessionList({ sessions }: SessionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const activeTabId = useTabStore(s => s.activeTabId);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  // Scroll to active session when tab changes
  useEffect(() => {
    if (!activeTabId?.startsWith('session:')) return;
    const sessionId = activeTabId.slice('session:'.length);
    const index = sessions.findIndex(s => s.session_id === sessionId);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  }, [activeTabId]);

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        <p className="text-sm">No sessions yet</p>
        <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">Click "New Session" to start</p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      <ul
        className="relative"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualItems.map((virtualItem) => {
          const session = sessions[virtualItem.index];
          return (
            <li
              key={session.session_id}
              className="absolute top-0 left-0 w-full pr-2"
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SessionItem session={session} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
