import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { ModelSelector } from '../common/ModelSelector';
import { FolderBrowserModal } from '../common/FolderBrowserModal';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { updateSettings, getSettings } from '../../api/settings';
import { fetchModels } from '../../api/models';
import { apiClient } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';
import { requestNotificationPermission, setDesktopNotificationSetting } from '../../utils/desktopNotifications';

type SettingsTab = 'general' | 'mobile' | 'notifications' | 'auth';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'auth', label: 'Authentication' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'notifications', label: 'Notifications' },
];

export function SettingsModal() {
  const { 
    isSettingsModalOpen, 
    closeSettingsModal, 
    settingsSection,
    availableModels, 
    defaultModel, 
    defaultReasoningEffort,
    setDefaultModel,
    setDefaultReasoningEffort,
    defaultCwd,
    setDefaultCwd 
  } = useUIStore();
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [selectedEffort, setSelectedEffort] = useState<string | null>(defaultReasoningEffort);
  const [selectedCwd, setSelectedCwd] = useState(defaultCwd);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Auto-select tab when opened; default to general (first tab)
  useEffect(() => {
    if (isSettingsModalOpen && settingsSection === 'auth') {
      setActiveTab('auth');
    } else if (isSettingsModalOpen) {
      setActiveTab('general');
    }
  }, [isSettingsModalOpen, settingsSection]);

  useEffect(() => {
    setSelectedModel(defaultModel);
    setSelectedEffort(defaultReasoningEffort);
    setSelectedCwd(defaultCwd);
    setError(null);
  }, [defaultModel, defaultReasoningEffort, defaultCwd, isSettingsModalOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateSettings({ 
        default_model: selectedModel,
        default_reasoning_effort: selectedEffort,
        default_cwd: selectedCwd || undefined
      });
      setDefaultModel(selectedModel);
      setDefaultReasoningEffort(selectedEffort);
      if (selectedCwd) {
        setDefaultCwd(selectedCwd);
      }
      closeSettingsModal();
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings. Check that the directory exists.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isSettingsModalOpen}
      onClose={closeSettingsModal}
      title="Settings"
      footer={
        activeTab === 'general' ? (
          <>
            <Button variant="secondary" onClick={closeSettingsModal}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={closeSettingsModal}>
            Close
          </Button>
        )
      }
    >
      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 dark:border-[#3a3a4e] -mx-6 px-6 mb-4 -mt-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'general' && (
        <GeneralTab
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedEffort={selectedEffort}
          selectedCwd={selectedCwd}
          error={error}
          onModelChange={(id, effort) => { setSelectedModel(id); setSelectedEffort(effort); }}
          onEffortChange={setSelectedEffort}
          onCwdChange={setSelectedCwd}
          onBrowseFolders={() => setShowFolderPicker(true)}
        />
      )}

      {activeTab === 'mobile' && (
        <MobileTab isOpen={isSettingsModalOpen} />
      )}

      {activeTab === 'notifications' && (
        <NotificationsTab isOpen={isSettingsModalOpen} />
      )}

      {activeTab === 'auth' && (
        <AuthenticationTab />
      )}

      <FolderBrowserModal
        isOpen={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(path) => setSelectedCwd(path)}
        initialPath={selectedCwd || undefined}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: General
// ---------------------------------------------------------------------------

interface GeneralTabProps {
  availableModels: any[];
  selectedModel: string;
  selectedEffort: string | null;
  selectedCwd: string;
  error: string | null;
  onModelChange: (id: string, effort: string | null) => void;
  onEffortChange: (effort: string | null) => void;
  onCwdChange: (cwd: string) => void;
  onBrowseFolders: () => void;
}

function GeneralTab({
  availableModels, selectedModel, selectedEffort, selectedCwd,
  error,
  onModelChange, onEffortChange, onCwdChange,
  onBrowseFolders,
}: GeneralTabProps) {
  const { theme, setTheme } = useTheme();
  const [versionInfo, setVersionInfo] = useState<{ sdk_version: string | null; cli_version: string | null; cli_source: string | null } | null>(null);

  useEffect(() => {
    apiClient.get<{ sdk_version: string | null; cli_version: string | null; cli_source: string | null }>('/settings/version-info')
      .then(setVersionInfo)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* Theme */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Theme
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
              theme === 'light'
                ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-600 dark:text-blue-400'
                : 'bg-white/50 border-white/40 text-gray-600 hover:bg-gray-50 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-400 dark:hover:bg-[#32324a]'
            }`}
          >
            ☀️ Light
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
              theme === 'dark'
                ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-600 dark:text-blue-400'
                : 'bg-white/50 border-white/40 text-gray-600 hover:bg-gray-50 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-400 dark:hover:bg-[#32324a]'
            }`}
          >
            🌙 Dark
          </button>
        </div>
      </div>

      {/* Default Model */}
      <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Default Model
        </label>
        <ModelSelector
          models={availableModels}
          selectedModelId={selectedModel}
          reasoningEffort={selectedEffort}
          onModelChange={onModelChange}
          onReasoningEffortChange={onEffortChange}
          variant="full"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          This model will be used for all new sessions.
        </p>
      </div>

      {/* Default Working Directory */}
      <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Default Working Directory
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={selectedCwd}
            onChange={(e) => onCwdChange(e.target.value)}
            className="flex-1 px-3 py-2 border border-white/40 bg-white/50 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent text-sm dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-100"
            placeholder="e.g., C:\Users\you\projects"
          />
          <button
            type="button"
            onClick={onBrowseFolders}
            className="px-3 py-2 border border-white/40 bg-white/50 rounded-md text-sm text-gray-600 hover:bg-gray-100 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-400 dark:hover:bg-[#32324a] transition-colors"
            title="Browse folders"
            aria-label="Browse folders"
          >
            📁
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          New sessions will start in this directory.
        </p>
      </div>

      {/* Version Info */}
      <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Copilot SDK Version</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">
            {versionInfo ? (versionInfo.sdk_version ?? '—') : '…'}
          </span>
          <span className="text-gray-500 dark:text-gray-400">CLI (in use) Version</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">
            {versionInfo ? (versionInfo.cli_version ?? '—') : '…'}
          </span>
          <span className="text-gray-500 dark:text-gray-400">CLI Source</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">
            {versionInfo ? (versionInfo.cli_source ?? '—') : '…'}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Mobile
// ---------------------------------------------------------------------------

function MobileTab({ isOpen }: { isOpen: boolean }) {
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [exposeMode, setExposeMode] = useState(false);
  const [devtunnelInstalled, setDevtunnelInstalled] = useState<boolean | null>(null);
  const [devtunnelLoggedIn, setDevtunnelLoggedIn] = useState(false);
  const [devtunnelInstallCmd, setDevtunnelInstallCmd] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    apiClient.get<{
      api_token: string;
      tunnel_url: string;
      expose: boolean;
      devtunnel_installed: boolean;
      devtunnel_logged_in: boolean;
      devtunnel_install_cmd: string;
    }>('/settings/mobile-companion')
      .then(data => {
        setApiToken(data.api_token);
        if (data.tunnel_url) setTunnelUrl(data.tunnel_url);
        setExposeMode(data.expose);
        setDevtunnelInstalled(data.devtunnel_installed);
        setDevtunnelLoggedIn(data.devtunnel_logged_in);
        setDevtunnelInstallCmd(data.devtunnel_install_cmd);
      })
      .catch(() => {
        apiClient.get<{ api_token: string }>('/settings/api-token')
          .then(data => setApiToken(data.api_token))
          .catch(() => {});
      });
  }, [isOpen]);

  const handleRegenerate = async () => {
    try {
      const data = await apiClient.post<{ api_token: string }>('/settings/api-token/regenerate');
      setApiToken(data.api_token);
    } catch (err) {
      console.error('Failed to regenerate token:', err);
    }
  };

  const qrValue = tunnelUrl && apiToken
    ? `${tunnelUrl.replace(/\/$/, '')}/mobile?token=${encodeURIComponent(apiToken)}&baseUrl=${encodeURIComponent(tunnelUrl)}`
    : null;

  const handleCopy = async () => {
    if (!apiToken) return;
    try {
      await navigator.clipboard.writeText(apiToken);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = apiToken;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* QR Code / Tunnel Status */}
      {qrValue ? (
        <div className="flex flex-col items-center py-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Scan with your phone to connect:
          </p>
          <div className="bg-white p-3 rounded-lg shadow-sm">
            <QRCodeSVG value={qrValue} size={180} />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center max-w-xs break-all">
            {tunnelUrl}/mobile
          </p>
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-[#1e1e2e] rounded-lg p-4 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {devtunnelInstalled === false ? (
              <>
                <span className="block mb-2">devtunnel CLI is not installed.</span>
                <code className="bg-gray-100 dark:bg-[#32324a] px-2 py-1 rounded text-xs font-mono select-all">{devtunnelInstallCmd}</code>
              </>
            ) : devtunnelInstalled && !devtunnelLoggedIn ? (
              <>
                <span className="block mb-2">devtunnel is installed but not logged in.</span>
                <code className="bg-gray-100 dark:bg-[#32324a] px-2 py-1 rounded text-xs font-mono">devtunnel user login</code>
              </>
            ) : exposeMode ? (
              'Waiting for tunnel to connect...'
            ) : (
              <>Run <code className="bg-gray-100 dark:bg-[#32324a] px-1.5 py-0.5 rounded text-xs font-mono">copilot-console --expose</code> to enable mobile access</>
            )}
          </p>
        </div>
      )}

      {/* Tunnel URL */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Tunnel URL
        </label>
        <input
          type="url"
          value={tunnelUrl}
          onChange={(e) => setTunnelUrl(e.target.value)}
          placeholder="https://your-id.devtunnels.ms"
          className="w-full px-3 py-1.5 text-sm border border-white/40 bg-white/50 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-100"
        />
        {exposeMode && tunnelUrl && (
          <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
            ✓ Auto-detected from devtunnel
          </p>
        )}
      </div>

      {/* API Token */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          API Token
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-gray-100 dark:bg-[#1e1e2e] px-2 py-1.5 rounded font-mono overflow-hidden text-ellipsis whitespace-nowrap min-h-[28px] leading-[20px]">
            {apiToken
              ? (showToken ? apiToken : '••••••••••••••••')
              : 'Loading...'}
          </code>
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 whitespace-nowrap"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 whitespace-nowrap"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <button
          type="button"
          onClick={handleRegenerate}
          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 mt-1"
        >
          Regenerate token
        </button>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Notifications (Push Subscriptions)
// ---------------------------------------------------------------------------

interface PushSub {
  endpoint: string;
}

function NotificationsTab({ isOpen }: { isOpen: boolean }) {
  const [subscriptions, setSubscriptions] = useState<PushSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [cliNotifications, setCliNotifications] = useState(false);
  const [desktopNotifications, setDesktopNotificationsLocal] = useState<string>('off');

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ subscriptions: PushSub[] }>('/push/subscriptions');
      setSubscriptions(data.subscriptions);
    } catch {
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchSubscriptions();
    getSettings().then(s => {
      setCliNotifications(s.cli_notifications ?? false);
      setDesktopNotificationsLocal(s.desktop_notifications ?? 'off');
    }).catch(() => {});
  }, [isOpen, fetchSubscriptions]);

  const handleRemove = async (endpoint: string) => {
    setRemoving(endpoint);
    try {
      // DELETE with body — use fetch directly since apiClient.delete doesn't support bodies
      const resp = await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      if (resp.ok) {
        setSubscriptions(prev => prev.filter(s => s.endpoint !== endpoint));
      } else {
        await fetchSubscriptions();
      }
    } catch {
      await fetchSubscriptions();
    } finally {
      setRemoving(null);
    }
  };

  const desktopToggle = (
    <div className="mb-4">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
        Desktop Notifications
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Show browser notifications when agent completes or needs input (30s delay, only if unread).
      </p>
      <div className="flex gap-1">
        {(['all', 'input_only', 'off'] as const).map(opt => (
          <button
            key={opt}
            type="button"
            onClick={async () => {
              if (opt !== 'off') {
                const granted = await requestNotificationPermission();
                if (!granted) return;
              }
              setDesktopNotificationsLocal(opt);
              setDesktopNotificationSetting(opt);
              try {
                await updateSettings({ desktop_notifications: opt } as any);
              } catch {
                // best-effort
              }
            }}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
              desktopNotifications === opt
                ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-600 dark:text-blue-400'
                : 'bg-white/50 border-white/40 text-gray-600 hover:bg-gray-50 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-400 dark:hover:bg-[#32324a]'
            }`}
          >
            {opt === 'all' ? 'All responses' : opt === 'input_only' ? 'Input needed only' : 'Off'}
          </button>
        ))}
      </div>
    </div>
  );

  const cliToggle = (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            CLI Notifications
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Receive desktop toast notifications when Copilot completes a response in CLI sessions.
            Toggle via CLI: <code className="bg-gray-100 dark:bg-[#1e1e2e] px-1 rounded text-xs">!cli-notify on</code>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cliNotifications}
          onClick={async () => {
            const newVal = !cliNotifications;
            setCliNotifications(newVal);
            try {
              await updateSettings({ cli_notifications: newVal } as any);
            } catch {
              setCliNotifications(!newVal);
            }
          }}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            cliNotifications ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              cliNotifications ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {desktopToggle}
        {cliToggle}
        <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4 flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">Loading subscriptions…</span>
        </div>
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div className="space-y-4">
        {desktopToggle}
        {cliToggle}
        <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4">
          <div className="bg-gray-50 dark:bg-[#1e1e2e] rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No devices registered.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Open the mobile companion to register for push notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {desktopToggle}
      {cliToggle}
      <div className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4 space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Devices registered for push notifications:
        </p>
        {subscriptions.map((sub) => {
          const truncated = truncateEndpoint(sub.endpoint);
          return (
            <div
              key={sub.endpoint}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50 dark:bg-[#1e1e2e] border border-gray-200 dark:border-[#3a3a4e]"
            >
              <span className="text-xs text-gray-600 dark:text-gray-400 flex-1 font-mono truncate" title={sub.endpoint}>
                {truncated}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(sub.endpoint)}
                disabled={removing === sub.endpoint}
                className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 whitespace-nowrap disabled:opacity-50"
              >
                {removing === sub.endpoint ? 'Removing…' : 'Remove'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function truncateEndpoint(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    return `${u.hostname}/…${path.length > 20 ? path.slice(-16) : path}`;
  } catch {
    return url.length > 50 ? url.slice(0, 24) + '…' + url.slice(-20) : url;
  }
}

// ---------------------------------------------------------------------------
// Tab 4: Authentication
// ---------------------------------------------------------------------------

interface DeviceCode {
  userCode: string;
  verificationUrl: string;
}

function AuthenticationTab() {
  const authStatus = useAuthStore(s => s.status);
  const setAuthStatus = useAuthStore(s => s.setStatus);
  const setAvailableModels = useUIStore(s => s.setAvailableModels);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const models = await fetchModels();
      setAvailableModels(models);
      const settings = await getSettings();
      if (settings.default_model) {
        useUIStore.getState().setDefaultModel(settings.default_model);
      }
    } catch { /* ignore — models will refresh on next page load */ }
  }, [setAvailableModels]);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<{ authenticated: boolean; provider: string | null; login: string | null }>('/auth/status');
      setAuthStatus({
        authenticated: data.authenticated,
        provider: data.provider ?? undefined,
        username: data.login ?? undefined,
      });
    } catch { /* ignore */ }
  }, [setAuthStatus]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setDeviceCode(null);
    setAuthError(null);

    try {
      const response = await fetch('/api/auth/login', { method: 'POST' });
      if (!response.ok) {
        setAuthError('Failed to start login flow');
        setConnecting(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setAuthError('SSE stream unavailable');
        setConnecting(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            // next data line
            const dataLine = lines[lines.indexOf(line) + 1];
            if (!dataLine?.startsWith('data: ')) continue;

            const rawData = dataLine.slice(6);
            try {
              const data = JSON.parse(rawData);
              if (eventType === 'output') {
                // Parse device code from output lines
                const codeLine = data.line as string;
                // Look for patterns like "XXXX-XXXX" or URLs
                const codeMatch = codeLine.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/);
                const urlMatch = codeLine.match(/(https?:\/\/\S+)/);
                if (codeMatch || urlMatch) {
                  setDeviceCode(prev => ({
                    userCode: codeMatch?.[1] || prev?.userCode || '',
                    verificationUrl: urlMatch?.[1] || prev?.verificationUrl || 'https://github.com/login/device',
                  }));
                }
              } else if (eventType === 'done') {
                setAuthStatus({
                  authenticated: data.authenticated,
                  provider: data.provider ?? undefined,
                  username: data.login ?? undefined,
                });
                setDeviceCode(null);
                setConnecting(false);
                await refreshModels();
                return;
              } else if (eventType === 'error') {
                setAuthError(data.message || 'Login failed');
                setConnecting(false);
                return;
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }

      // Stream ended — refresh status
      await refreshAuthStatus();
      await refreshModels();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }, [setAuthStatus, refreshAuthStatus, refreshModels]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    setAuthError(null);
    try {
      await apiClient.post('/auth/logout');
      await refreshAuthStatus();
      await refreshModels();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  }, [refreshAuthStatus, refreshModels]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Manage authentication providers for Copilot sessions.
      </p>

      {/* Provider Row */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
        authStatus.authenticated
          ? 'bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800'
          : 'bg-gray-50 dark:bg-[#1e1e2e] border-gray-200 dark:border-[#3a3a4e]'
      }`}>
        {authStatus.authenticated ? (
          <span className="text-lg">🔒</span>
        ) : (
          <span className="text-lg">🔐</span>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            GitHub Copilot{authStatus.authenticated && authStatus.username ? ` (${authStatus.username})` : ''}
          </span>
          {!authStatus.authenticated && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              — Not connected
            </span>
          )}
        </div>
        {authStatus.authenticated ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>

      {/* Device Code Card */}
      {connecting && deviceCode && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Waiting for authorization…
            </span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            Open the link below and enter the code:
          </p>
          <div className="bg-white dark:bg-[#1e1e2e] rounded-md px-4 py-3 text-center mb-3">
            <span className="text-2xl font-mono font-bold tracking-widest text-gray-900 dark:text-gray-100">
              {deviceCode.userCode}
            </span>
          </div>
          <a
            href={deviceCode.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Open GitHub
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      )}

      {/* Connecting but no device code yet */}
      {connecting && !deviceCode && (
        <div className="flex items-center gap-2 py-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
          Starting login flow…
        </div>
      )}

      {/* Error */}
      {authError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-400">{authError}</p>
        </div>
      )}
    </div>
  );
}
