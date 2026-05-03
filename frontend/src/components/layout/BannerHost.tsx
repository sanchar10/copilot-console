import { useBannerStore, type BannerSeverity } from '../../stores/bannerStore';

const SEVERITY_CLASSES: Record<BannerSeverity, string> = {
  info: 'bg-blue-600 dark:bg-blue-700 text-white',
  warning: 'bg-amber-600 dark:bg-amber-700 text-white',
  error: 'bg-red-600 dark:bg-red-700 text-white',
  success: 'bg-emerald-600 dark:bg-emerald-700 text-white',
};

const SEVERITY_DISMISS_HOVER: Record<BannerSeverity, string> = {
  info: 'text-blue-200 hover:text-white',
  warning: 'text-amber-200 hover:text-white',
  error: 'text-red-200 hover:text-white',
  success: 'text-emerald-200 hover:text-white',
};

/**
 * Renders all currently-registered banners stacked top-to-bottom.
 * Newest banner appears at the top of the stack.
 */
export function BannerHost() {
  const banners = useBannerStore((s) => s.banners);
  const dismiss = useBannerStore((s) => s.dismiss);

  if (banners.length === 0) return null;

  // Newest on top — store appends, so reverse for display.
  const ordered = [...banners].reverse();

  return (
    <div className="flex flex-col">
      {ordered.map((b) => {
        const dismissible = b.dismissible !== false;
        return (
          <div
            key={b.id}
            role="status"
            className={`px-4 py-2 text-sm flex items-center justify-between gap-2 ${SEVERITY_CLASSES[b.severity]}`}
          >
            <div className="flex-1 min-w-0">{b.content}</div>
            {dismissible && (
              <button
                onClick={() => dismiss(b.id)}
                className={`ml-4 shrink-0 ${SEVERITY_DISMISS_HOVER[b.severity]}`}
                title="Dismiss"
                aria-label="Dismiss banner"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
