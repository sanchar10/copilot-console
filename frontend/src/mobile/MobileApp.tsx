import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { Routes, Route, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { MobileSessionList } from './components/MobileSessionList';
import { MobileChatView } from './components/MobileChatView';
import { MobileAgentMonitor } from './components/MobileAgentMonitor';
import { MobileSettings } from './components/MobileSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { mobileApiClient, setStoredToken, setStoredBaseUrl, getStoredToken, getStoredBaseUrl, onAuthErrorChange, clearAuthError, getAuthError } from './mobileClient';
import { useTheme } from '../hooks/useTheme';
import './mobile.css';

// Error boundary to catch render crashes and show a recovery UI
class MobileErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[MobileErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-[#fafafa] dark:bg-[#1e1e2e]">
          <p className="text-4xl mb-3">💥</p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 max-w-xs break-all">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg"
          >
            Back to Sessions
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type TabId = 'sessions' | 'agents' | 'settings';

/** Error screen with auto-recovery on network reconnect */
function ConnectionErrorScreen({ authError, onRetry, onReconfigure }: {
  authError: 'unauthorized' | 'network';
  onRetry: () => void;
  onReconfigure: () => void;
}) {
  useEffect(() => {
    if (authError !== 'network') return;
    const handleOnline = () => onRetry();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [authError, onRetry]);

  return (
    <div className="h-dvh bg-[#fafafa] dark:bg-[#1e1e2e] flex flex-col items-center justify-center p-6 text-center safe-top">
      <div className="text-5xl mb-4">{authError === 'unauthorized' ? '🔑' : '📡'}</div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {authError === 'unauthorized' ? 'Session Expired' : 'Connection Lost'}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-2 max-w-xs">
        {authError === 'unauthorized'
          ? 'Your API token has been regenerated. Please scan the QR code again from the desktop Settings.'
          : 'Unable to reach the server. Check your internet connection and retry.'}
      </p>
      {authError === 'network' && getStoredBaseUrl() && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6 max-w-xs break-all">
          Server: {getStoredBaseUrl()}
        </p>
      )}
      {authError !== 'network' && <div className="mb-6" />}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button onClick={onRetry} className="bg-blue-600 text-white rounded-lg py-3 px-4 font-medium">
          Retry Connection
        </button>
        <button onClick={onReconfigure} className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg py-3 px-4 font-medium">
          Re-configure Connection
        </button>
      </div>
    </div>
  );
}

export function MobileApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<'unauthorized' | 'network' | null>(getAuthError());
  const [notification, setNotification] = useState<{ message: string; sessionId?: string } | null>(null);

  useTheme();

  // Extract token/baseUrl from URL params SYNCHRONOUSLY before any child effects fire.
  // This prevents a race where child components make API calls with a stale token.
  const urlToken = searchParams.get('token');
  const urlBaseUrl = searchParams.get('baseUrl');
  if (urlToken) {
    setStoredToken(urlToken);
    clearAuthError();
  }
  if (urlBaseUrl) {
    setStoredBaseUrl(urlBaseUrl);
  }

  // Clean URL after extracting params (must be in effect for navigation)
  useEffect(() => {
    if (urlToken || urlBaseUrl) {
      navigate('/mobile', { replace: true });
    }
  }, [urlToken, urlBaseUrl, navigate]);

  // Test connection on mount and when returning to app
  const [, forceRender] = useState(0);
  const handleConnectionChange = useCallback(async () => {
    // Force immediate re-render so the token check re-evaluates
    forceRender((n) => n + 1);
    const ok = await mobileApiClient.testConnection();
    setConnected(ok);
  }, []);

  useEffect(() => {
    handleConnectionChange();
    const interval = setInterval(handleConnectionChange, 30000);
    return () => clearInterval(interval);
  }, [handleConnectionChange]);

  // Subscribe to global auth errors from mobileClient
  useEffect(() => {
    return onAuthErrorChange(setAuthError);
  }, []);

  // Show "Disconnected" banner when phone goes offline
  useEffect(() => {
    const handleOffline = () => setConnected(false);
    const handleOnline = () => setConnected(true);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // On localhost, no token is needed (backend skips auth for localhost)
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Show setup screen if no token configured AND not on localhost
  if (!isLocalhost && !getStoredToken() && !searchParams.get('token')) {
    const savedUrl = getStoredBaseUrl();
    return (
      <div className="h-dvh bg-[#fafafa] dark:bg-[#1e1e2e] flex flex-col safe-top">
        {/* Welcome header */}
        <div className="px-6 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">🤖</span>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Copilot Console</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Connect to your Copilot Console server to get started
          </p>
        </div>

        {/* Reconnect prompt when we have a saved URL but no token */}
        {savedUrl && (
          <div className="mx-6 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last connected to:</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 font-mono break-all mb-2">{savedUrl}</p>
            <button
              onClick={() => {
                setStoredBaseUrl(savedUrl);
                handleConnectionChange();
              }}
              className="w-full bg-blue-600 text-white text-sm rounded-lg py-2 px-3 font-medium"
            >
              Reconnect
            </button>
          </div>
        )}

        {/* Existing settings for QR scan / manual entry */}
        <div className="flex-1 overflow-auto">
          <MobileSettings onConnectionChange={handleConnectionChange} />
        </div>
      </div>
    );
  }

  // Show re-auth screen when token is invalid or connection lost
  // Skip if already navigating to settings (prevents double-click issue)
  if (authError && !location.pathname.includes('/settings')) {
    return (
      <ConnectionErrorScreen
        authError={authError}
        onRetry={() => { clearAuthError(); handleConnectionChange(); }}
        onReconfigure={() => { clearAuthError(); navigate('/mobile/settings', { replace: true }); }}
      />
    );
  }

  // Determine active tab from URL
  const getActiveTab = (): TabId => {
    const path = location.pathname;
    if (path.includes('/agents')) return 'agents';
    if (path.includes('/settings')) return 'settings';
    return 'sessions';
  };
  const activeTab = getActiveTab();

  return (
    <div className="h-dvh bg-[#fafafa] dark:bg-[#1e1e2e] flex flex-col safe-top">
      {/* Connection indicator */}
      {connected === false && (
        <div className="bg-red-500 text-white text-center text-xs py-1">
          Disconnected — check your connection
        </div>
      )}

      {/* Notification banner */}
      {notification && (
        <NotificationBanner
          message={notification.message}
          onDismiss={() => setNotification(null)}
          onTap={notification.sessionId ? () => {
            navigate(`/mobile/chat/${notification.sessionId}`);
            setNotification(null);
          } : undefined}
        />
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <MobileErrorBoundary onReset={() => navigate('/mobile')}>
        <Routes>
          <Route index element={<MobileSessionList onNotification={setNotification} />} />
          <Route path="chat/:sessionId" element={<MobileChatView />} />
          <Route path="agents" element={<MobileAgentMonitor />} />
          <Route path="settings" element={<MobileSettings onConnectionChange={handleConnectionChange} />} />
        </Routes>
        </MobileErrorBoundary>
      </div>

      {/* Bottom tab navigation — hidden when in chat view */}
      {!location.pathname.includes('/chat/') && (
        <nav className="bg-white dark:bg-[#252536] border-t border-gray-200 dark:border-[#3a3a4e] flex safe-bottom">
          <TabButton
            icon="💬"
            label="Sessions"
            active={activeTab === 'sessions'}
            onClick={() => navigate('/mobile')}
          />
          <TabButton
            icon="🤖"
            label="Agents"
            active={activeTab === 'agents'}
            onClick={() => navigate('/mobile/agents')}
          />
          <TabButton
            icon="⚙️"
            label="Settings"
            active={activeTab === 'settings'}
            onClick={() => navigate('/mobile/settings')}
          />
        </nav>
      )}
    </div>
  );
}

function TabButton({ icon, label, active, onClick, badge }: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center py-1 gap-0 transition-colors ${
        active
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      <span className="text-xl relative">
        {icon}
        {badge && badge > 0 && (
          <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
