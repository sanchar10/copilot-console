import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStoredToken,
  getStoredBaseUrl,
  setStoredToken,
  setStoredBaseUrl,
  clearStoredCredentials,
  mobileApiClient,
  subscribeToPush,
  unsubscribeFromPush,
  isPushSubscribed,
} from '../mobileClient';
import { QRScanner } from './QRScanner';

interface Props {
  onConnectionChange: () => void;
}

export function MobileSettings({ onConnectionChange }: Props) {
  const navigate = useNavigate();
  const [token, setToken] = useState(getStoredToken() || '');
  const [baseUrl, setBaseUrl] = useState(getStoredBaseUrl() || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [saved, setSaved] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');

  // Check push subscription status on mount
  useEffect(() => {
    if ('Notification' in window) {
      setPushPermission(Notification.permission);
    }
    isPushSubscribed().then(setPushEnabled).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (baseUrl.trim()) {
      setStoredBaseUrl(baseUrl.trim());
    }
    if (token.trim()) {
      setStoredToken(token.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onConnectionChange();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    // Temporarily store for testing
    if (baseUrl.trim()) setStoredBaseUrl(baseUrl.trim());
    if (token.trim()) setStoredToken(token.trim());

    const ok = await mobileApiClient.testConnection();
    setTestResult(ok ? 'success' : 'error');
    setTesting(false);
    if (ok) {
      onConnectionChange();
      navigate('/mobile', { replace: true });
    }
  };

  const handleDisconnect = () => {
    clearStoredCredentials();
    setToken('');
    setBaseUrl('');
    setTestResult(null);
    onConnectionChange();
  };

  const isConfigured = !!getStoredToken();

  // Parse a QR code link (e.g., https://...devtunnels.ms/mobile?token=xxx&baseUrl=yyy)
  const handlePasteLink = (link: string) => {
    try {
      const url = new URL(link);
      const urlToken = url.searchParams.get('token');
      const urlBase = url.searchParams.get('baseUrl');
      if (urlToken) setToken(urlToken);
      if (urlBase) setBaseUrl(urlBase);
      if (!urlBase) {
        // Derive baseUrl from the pasted URL's origin
        setBaseUrl(url.origin);
      }
    } catch {
      // Not a valid URL — ignore
    }
  };

  const handleQRScan = (data: string) => {
    setShowScanner(false);
    handlePasteLink(data);
    // Auto-save after scan
    try {
      const url = new URL(data);
      const scannedToken = url.searchParams.get('token');
      const scannedBase = url.searchParams.get('baseUrl');
      if (scannedToken) setStoredToken(scannedToken);
      if (scannedBase) setStoredBaseUrl(scannedBase);
      else setStoredBaseUrl(url.origin);
      onConnectionChange();
    } catch {
      // Not a valid URL
    }
  };

  const handlePushToggle = async () => {
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          setPushPermission(perm);
          if (perm !== 'granted') {
            setPushLoading(false);
            return;
          }
        } else if (Notification.permission === 'denied') {
          setPushLoading(false);
          return;
        }
        const ok = await subscribeToPush();
        setPushEnabled(ok);
      }
    } catch (err) {
      console.error('Push toggle error:', err);
    }
    setPushLoading(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* QR Scanner overlay */}
      {showScanner && (
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      )}

      {/* Header */}
      <div className="px-4 pt-4 pb-2 bg-white dark:bg-[#252536] border-b border-gray-200 dark:border-[#3a3a4e]">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Connect to your Copilot Console
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Connection setup */}
        <section className="bg-white dark:bg-[#2a2a3c] rounded-xl p-4 shadow-sm border border-gray-100 dark:border-[#3a3a4e]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Connection</h2>

          {!isConfigured ? (
            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg p-3 mb-4 text-sm">
              <p className="font-medium">Quick Setup</p>
              <p className="text-xs mt-1 mb-3">
                Scan the QR code from your desktop Copilot Console settings.
              </p>
              <button
                onClick={() => setShowScanner(true)}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg"
              >
                📷 Scan QR Code
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowScanner(true)}
              className="w-full py-2 mb-3 text-sm text-blue-600 dark:text-blue-400 rounded-lg border border-blue-200 dark:border-blue-800"
            >
              📷 Re-scan QR Code
            </button>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Server URL
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-tunnel-url.devtunnels.ms"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-gray-50 dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                API Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your API token"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-gray-50 dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 placeholder-gray-400"
              />
            </div>

            {testResult && (
              <div className={`text-xs rounded-lg p-2 ${
                testResult === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              }`}>
                {testResult === 'success' ? '✓ Connected successfully' : '✗ Connection failed — check URL and token'}
              </div>
            )}

            {saved && (
              <div className="text-xs rounded-lg p-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
                ✓ Settings saved
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleTest}
                disabled={testing || (!token.trim() && !baseUrl.trim())}
                className="flex-1 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-[#3a3a4e] text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                {testing ? 'Testing...' : 'Test'}
              </button>
              <button
                onClick={handleSave}
                disabled={!token.trim()}
                className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white disabled:opacity-40"
              >
                Save
              </button>
            </div>

            {isConfigured && (
              <button
                onClick={handleDisconnect}
                className="w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800"
              >
                Disconnect
              </button>
            )}
          </div>
        </section>

        {/* Push Notifications */}
        {isConfigured && 'Notification' in window && (
          <section className="bg-white dark:bg-[#2a2a3c] rounded-xl p-4 shadow-sm border border-gray-100 dark:border-[#3a3a4e]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Notifications</h2>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-900 dark:text-gray-100">Push Notifications</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {pushPermission === 'denied'
                    ? 'Blocked in system settings'
                    : pushEnabled
                      ? 'You\'ll be notified when agents respond'
                      : 'Get notified when agents finish'}
                </p>
              </div>
              <button
                onClick={handlePushToggle}
                disabled={pushLoading || pushPermission === 'denied'}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                  pushEnabled
                    ? 'bg-blue-600'
                    : 'bg-gray-300 dark:bg-gray-600'
                } ${pushLoading || pushPermission === 'denied' ? 'opacity-40' : ''}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                    pushEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {pushPermission === 'denied' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                Notifications are blocked. Enable them in your device's settings for this app.
              </p>
            )}
          </section>
        )}

        {/* Help */}
        <section className="bg-white dark:bg-[#2a2a3c] rounded-xl p-4 shadow-sm border border-gray-100 dark:border-[#3a3a4e]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">How to connect</h2>
          <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
            <li>On your desktop, start Copilot Console with <code className="bg-gray-100 dark:bg-[#1e1e2e] px-1 py-0.5 rounded">--expose</code></li>
            <li>Open Settings in the desktop UI → Mobile Companion section</li>
            <li>Tap <strong>📷 Scan QR Code</strong> above and scan the code from your desktop</li>
            <li>Or manually enter the <strong>Server URL</strong> and <strong>API Token</strong> shown on desktop</li>
            <li>Tap <strong>Save</strong> to connect</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
