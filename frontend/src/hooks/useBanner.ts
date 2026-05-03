import { useEffect } from 'react';
import { useBannerStore, type Banner } from '../stores/bannerStore';

/**
 * Declaratively register a banner for as long as `banner` is non-null and
 * the calling component is mounted. Pass null to remove.
 *
 * The add/cleanup lifecycle is tied to `id` only — re-renders that produce
 * a fresh React element for `content` (a common case in React) won't churn
 * the registration or wipe the user's dismissal. Content/severity updates
 * are handled by a second effect that just replaces the entry in place,
 * which is a no-op once the user has dismissed the banner.
 */
export function useBanner(banner: Banner | null): void {
  const add = useBannerStore((s) => s.add);
  const remove = useBannerStore((s) => s.remove);

  const id = banner?.id ?? null;

  useEffect(() => {
    if (!banner) return;
    add(banner);
    return () => remove(banner.id);
    // We intentionally key on `id` only — see file docstring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!banner) return;
    add(banner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.severity, banner?.content, banner?.dismissible]);
}
