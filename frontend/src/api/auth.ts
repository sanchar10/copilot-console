/**
 * Auth API helpers.
 *
 * Single place that owns the wire-format ↔ store-format translation for
 * `/auth/status`. The backend returns `{ authenticated, provider, login }`;
 * the frontend `AuthStatus` type uses `username`. Without a single helper
 * doing the rename, callers that copy the response straight into the
 * store end up with `username: undefined` (silent TypeScript hole because
 * `apiClient.get<AuthStatus>` doesn't validate at runtime).
 */

import { apiClient } from './client';
import type { AuthStatus } from '../stores/authStore';

/** Wire-format response from `GET /api/auth/status`. */
interface AuthStatusResponse {
  authenticated: boolean | null;
  provider?: string | null;
  login?: string | null;
}

/** Fetch current auth status, normalised to the frontend's `AuthStatus` shape. */
export async function getAuthStatus(): Promise<AuthStatus> {
  const data = await apiClient.get<AuthStatusResponse>('/auth/status');
  return {
    authenticated: data.authenticated,
    provider: data.provider ?? undefined,
    username: data.login ?? undefined,
  };
}
