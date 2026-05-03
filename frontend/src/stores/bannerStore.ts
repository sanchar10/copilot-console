/**
 * Banner registry — top-of-app-bar persistent banners that stack.
 *
 * Differs from toasts:
 *  - Persistent (no auto-dismiss timer)
 *  - Stacked above the main UI, not floating
 *  - De-duplicated by stable `id` so producers can re-add safely
 *  - User dismissal is remembered until the producer removes the banner,
 *    so toggling the underlying state (e.g. update available → installed →
 *    new update available) will re-show the banner on the next trigger.
 *
 * Usage from a producer component:
 *   useBanner(condition ? { id: 'update', severity: 'info', content: '…' } : null);
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';

export type BannerSeverity = 'info' | 'warning' | 'error' | 'success';

export interface Banner {
  id: string;
  severity: BannerSeverity;
  content: ReactNode;
  /** Whether the user can hide it with the X. Defaults to true. */
  dismissible?: boolean;
}

interface BannerState {
  banners: Banner[];
  dismissedIds: Set<string>;
  /** Add a banner. No-op if its id has been dismissed by the user. */
  add: (banner: Banner) => void;
  /** Remove a banner. Also clears the dismissed flag so re-adding will show again. */
  remove: (id: string) => void;
  /** Mark a banner dismissed by the user. */
  dismiss: (id: string) => void;
}

export const useBannerStore = create<BannerState>((set) => ({
  banners: [],
  dismissedIds: new Set<string>(),

  add: (banner) =>
    set((state) => {
      if (state.dismissedIds.has(banner.id)) return state;
      // De-dup by id; replace existing entry to allow content updates.
      const filtered = state.banners.filter((b) => b.id !== banner.id);
      return { banners: [...filtered, banner] };
    }),

  remove: (id) =>
    set((state) => {
      const next = new Set(state.dismissedIds);
      next.delete(id);
      return {
        banners: state.banners.filter((b) => b.id !== id),
        dismissedIds: next,
      };
    }),

  dismiss: (id) =>
    set((state) => {
      const next = new Set(state.dismissedIds);
      next.add(id);
      return {
        banners: state.banners.filter((b) => b.id !== id),
        dismissedIds: next,
      };
    }),
}));
