import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { useTabStore } from '../../stores/tabStore';
import { getSession, disconnectSession } from '../../api/sessions';
import { clearReadySession } from './InputBox';

export function TabBar() {
  const { sessions, isNewSession, clearNewSession } = useSessionStore();
  const { messagesPerSession, setMessages, clearSessionMessages } = useChatStore();
  const { tabs, activeTabId, switchTab, closeTab } = useTabStore();

  const handleTabClick = async (tab: { id: string; type: string; sessionId?: string }) => {
    if (tab.id === activeTabId) return;

    // Clear new-session mode when switching to an existing tab
    clearNewSession();

    if (tab.type === 'session' && tab.sessionId) {
      // Load messages if not cached
      if (!messagesPerSession[tab.sessionId]) {
        try {
          const sessionData = await getSession(tab.sessionId);
          setMessages(tab.sessionId, sessionData.messages);
        } catch (err) {
          console.error('Failed to switch tab:', err);
          return;
        }
      }
    }

    switchTab(tab.id);
  };

  const handleTabClose = async (e: React.MouseEvent, tab: { id: string; type: string; sessionId?: string }) => {
    e.stopPropagation();

    // Close tab immediately for instant UI response
    closeTab(tab.id);

    if (tab.type === 'session' && tab.sessionId) {
      clearSessionMessages(tab.sessionId);
      // Disconnect in background — don't block UI
      disconnectSession(tab.sessionId)
        .then(() => clearReadySession(tab.sessionId!))
        .catch(() => {});
    }
  };

  if (tabs.length === 0 && !isNewSession) {
    return null;
  }

  return (
    <div className="flex items-center bg-gray-50 dark:bg-[#252536] border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {/* All open tabs */}
      {tabs.map((tab) => {
        const label = tab.type === 'session'
          ? sessions.find((s) => s.session_id === tab.sessionId)?.session_name || tab.label
          : tab.label;

        return (
          <div
            key={tab.id}
            onClick={() => handleTabClick(tab)}
            className={`group flex items-center gap-2 px-4 py-2 border-r border-gray-200 dark:border-gray-700 cursor-pointer whitespace-nowrap min-w-[120px] max-w-[200px]
              ${activeTabId === tab.id
                ? 'bg-white dark:bg-[#32324a] border-b-2 border-b-blue-500 dark:border-b-blue-400' 
                : 'hover:bg-gray-50 dark:hover:bg-[#2a2a3c]'}`}
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
              {label}
            </span>
            <button
              onClick={(e) => handleTabClose(e, tab)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity flex-shrink-0"
              title="Close tab"
            >
              <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}

      {/* New session tab — rendered after existing tabs so it appears on the right */}
      {isNewSession && (
        <div
          onClick={() => {
            // Deactivate all tabs to show new-session view
            useTabStore.setState({ activeTabId: null });
          }}
          className={`group flex items-center gap-2 px-4 py-2 border-r border-gray-200 dark:border-gray-700 cursor-pointer whitespace-nowrap min-w-[120px] max-w-[200px]
            ${activeTabId === null ? 'bg-white dark:bg-[#32324a] border-b-2 border-b-blue-500 dark:border-b-blue-400' : 'hover:bg-gray-50 dark:hover:bg-[#2a2a3c]'}`}
        >
          <span className="text-sm font-medium text-gray-700 dark:text-gray-100">New Session</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearNewSession();
              // Restore last tab if activeTabId was cleared
              const { tabs: currentTabs, activeTabId: currentActive } = useTabStore.getState();
              if (!currentActive && currentTabs.length > 0) {
                useTabStore.setState({ activeTabId: currentTabs[currentTabs.length - 1].id });
              }
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity flex-shrink-0"
            title="Cancel new session"
          >
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
