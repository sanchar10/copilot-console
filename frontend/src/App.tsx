import { useEffect } from 'react';
import { Layout } from './components/layout/Layout';
import { ChatPane } from './components/chat/ChatPane';
import { SettingsModal } from './components/session/SettingsModal';
import { AgentMonitor } from './components/session/AgentMonitor';
import { useSessionStore } from './stores/sessionStore';
import { useTabStore } from './stores/tabStore';
import { useViewedStore } from './stores/viewedStore';
import { useAgentMonitorStore } from './stores/agentMonitorStore';
import { useTheme } from './hooks/useTheme';

function App() {
  const refreshMcpServers = useSessionStore((state) => state.refreshMcpServers);
  const refreshTools = useSessionStore((state) => state.refreshTools);
  const tabs = useTabStore((state) => state.tabs);
  const { loadViewedTimestamps } = useViewedStore();
  const { isOpen: isAgentMonitorOpen, setOpen: setAgentMonitorOpen } = useAgentMonitorStore();

  // Initialize theme from localStorage on mount
  useTheme();

  // Load available MCP servers, tools, and viewed timestamps on app startup
  useEffect(() => {
    refreshMcpServers();
    refreshTools();
    loadViewedTimestamps();
  }, [refreshMcpServers, refreshTools, loadViewedTimestamps]);

  // Disconnect all open sessions when browser tab closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sessionIds = tabs
        .filter((t) => t.type === 'session' && t.sessionId)
        .map((t) => t.sessionId!);
      for (const sessionId of sessionIds) {
        navigator.sendBeacon(`/api/sessions/${sessionId}/disconnect`);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tabs]);

  return (
    <Layout>
      <ChatPane />
      <SettingsModal />
      {isAgentMonitorOpen && <AgentMonitor onClose={() => setAgentMonitorOpen(false)} />}
    </Layout>
  );
}

export default App;
