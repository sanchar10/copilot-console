import type { ApiClientInterface } from './apiInterface';
import { useToastStore } from '../stores/toastStore';

const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Wrap fetch to surface "backend is not running" as a single dedup'd toast.
 *
 * `fetch()` rejects with a `TypeError` when the server is unreachable
 * (ECONNREFUSED, DNS failure, etc.). `AbortError` from AbortController is
 * unrelated to connectivity and is left silent. All errors are re-thrown
 * unchanged so existing callers behave identically.
 */
async function safeFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      // Use a fixed id so a burst of failed requests collapses into one toast.
      useToastStore.getState().addToast(
        'Copilot Console server unreachable',
        'error',
        { id: 'server-down', duration: 5000 },
      );
    }
    throw err;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || response.statusText);
  }
  return response.json();
}

export const apiClient: ApiClientInterface = {
  async get<T>(path: string): Promise<T> {
    const response = await safeFetch(`${API_BASE}${path}`);
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await safeFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const response = await safeFetch(`${API_BASE}${path}`, {
      method: 'DELETE',
    });
    return handleResponse<T>(response);
  },

  createEventSource(path: string, params?: Record<string, string>): EventSource {
    const searchParams = new URLSearchParams(params || {});
    const qs = searchParams.toString();
    const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
    return new EventSource(url);
  },
};
