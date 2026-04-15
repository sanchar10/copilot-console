import type { ApiClientInterface } from '../api/apiInterface';

/**
 * Mobile-aware API client with bearer token authentication.
 *
 * Uses the same API shape as the desktop client but adds:
 * - Configurable base URL (for tunnel access)
 * - Bearer token in Authorization header
 * - Connection state management
 */

const STORAGE_KEY_TOKEN = 'copilotconsole_api_token';
const STORAGE_KEY_BASE_URL = 'copilotconsole_base_url';

/** Get the stored API token */
export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_TOKEN);
}

/** Store the API token */
export function setStoredToken(token: string): void {
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
}

/** Get the stored base URL (tunnel URL) */
export function getStoredBaseUrl(): string | null {
  return localStorage.getItem(STORAGE_KEY_BASE_URL);
}

/** Store the base URL */
export function setStoredBaseUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY_BASE_URL, url);
}

/** Clear all stored credentials */
export function clearStoredCredentials(): void {
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_BASE_URL);
}

/** Resolve the API base URL */
export function getApiBase(): string {
  const baseUrl = getStoredBaseUrl();
  if (baseUrl) {
    // Remote access via tunnel — use full URL
    return `${baseUrl.replace(/\/$/, '')}/api`;
  }
  // Local access — use relative path
  return '/api';
}

/** Build headers with optional auth token */
export function getHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export class MobileApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MobileApiError';
    this.status = status;
  }
}

/** Global auth error state — components can subscribe to this */
let _authError: 'unauthorized' | 'network' | null = null;
const _authErrorListeners = new Set<(error: 'unauthorized' | 'network' | null) => void>();

export function getAuthError(): 'unauthorized' | 'network' | null {
  return _authError;
}

export function clearAuthError(): void {
  _authError = null;
  _authErrorListeners.forEach((fn) => fn(null));
}

export function onAuthErrorChange(fn: (error: 'unauthorized' | 'network' | null) => void): () => void {
  _authErrorListeners.add(fn);
  return () => _authErrorListeners.delete(fn);
}

function setAuthError(error: 'unauthorized' | 'network'): void {
  _authError = error;
  _authErrorListeners.forEach((fn) => fn(error));
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403) {
    setAuthError('unauthorized');
    throw new MobileApiError(response.status, 'Token expired or invalid');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new MobileApiError(response.status, data.error || response.statusText);
  }
  return response.json();
}

/** Wrapper for fetch that catches network errors and sets auth error state */
async function safeFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    // Only show error screen if network is available but server unreachable (tunnel changed)
    // When offline, stay silent — SSE backoff will auto-recover when network returns
    if (navigator.onLine) {
      setAuthError('network');
    }
    throw err;
  }
}

export const mobileApiClient: ApiClientInterface & { testConnection(): Promise<boolean> } = {
  async get<T>(path: string): Promise<T> {
    const response = await safeFetch(`${getApiBase()}${path}`, {
      headers: getHeaders(),
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await safeFetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const response = await safeFetch(`${getApiBase()}${path}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<T>(response);
  },

  /** Create an EventSource with auth (SSE doesn't support headers natively,
   *  so we pass the token as a query param for SSE endpoints). */
  createEventSource(path: string, params?: Record<string, string>): EventSource {
    const base = getApiBase();
    const token = getStoredToken();
    const searchParams = new URLSearchParams(params || {});
    if (token) {
      searchParams.set('token', token);
    }
    const qs = searchParams.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    return new EventSource(url);
  },

  /** Test the connection to the backend */
  async testConnection(): Promise<boolean> {
    try {
      // Use an authenticated API endpoint to verify both connectivity and token
      const response = await fetch(`${getApiBase()}/sessions`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};

// --- Push Notification Helpers ---

/** Convert a base64 URL-safe string to Uint8Array (for VAPID key) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Get VAPID public key from server */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const data = await mobileApiClient.get<{ public_key: string }>('/push/vapid-key');
    return data.public_key;
  } catch {
    return null;
  }
}

/** Subscribe to push notifications */
export async function subscribeToPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const vapidKey = await getVapidPublicKey();
    if (!vapidKey) return false;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });

    const sub = subscription.toJSON();
    await mobileApiClient.post('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.keys,
    });
    return true;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return false;
  }
}

/** Unsubscribe from push notifications */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      // Send DELETE with body via safeFetch directly (mobileClient.delete doesn't support body)
      await safeFetch(`${getApiBase()}/push/subscribe`, {
        method: 'DELETE',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ endpoint }),
      });
      await subscription.unsubscribe();
    }
    return true;
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
    return false;
  }
}

/** Check if currently subscribed to push (local service worker check only) */
export async function isPushSubscribed(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/**
 * Verify the local push subscription is still registered on the backend.
 * Returns true if registered, false if removed (e.g., from desktop console).
 * Returns null if verification couldn't be performed (no local subscription, network error, etc.).
 */
export async function verifyPushSubscriptionWithServer(): Promise<boolean | null> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;

    const data = await mobileApiClient.get<{ subscriptions: { endpoint: string }[] }>('/push/subscriptions');
    const serverEndpoints = data.subscriptions.map((s) => s.endpoint);
    return serverEndpoints.includes(subscription.endpoint);
  } catch {
    return null;
  }
}
