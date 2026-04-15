import { useRef, useState, useEffect, useCallback } from 'react';

interface ScrollableRowProps {
  children: React.ReactNode;
  className?: string;
  /** Background color class for light mode fade gradient (default: from-white) */
  fadeFromLight?: string;
  /** Background color class for dark mode fade gradient (default: dark:from-[#252536]) */
  fadeFromDark?: string;
}

/**
 * Horizontally scrollable row with hidden scrollbar and fade-edge indicators.
 * Fades appear only on the side(s) that have more content to scroll to.
 */
export function ScrollableRow({
  children,
  className = '',
  fadeFromLight = 'from-white',
  fadeFromDark = 'dark:from-[#252536]',
}: ScrollableRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setShowLeftFade(scrollLeft > 2);
    setShowRightFade(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFades();
    el.addEventListener('scroll', updateFades, { passive: true });
    // ResizeObserver may not exist in test environments (jsdom)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateFades) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateFades);
      observer?.disconnect();
    };
  }, [updateFades]);

  return (
    <div className="relative min-w-0 flex-1">
      {showLeftFade && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-gradient-to-r ${fadeFromLight} ${fadeFromDark} to-transparent`}
        />
      )}
      <div
        ref={scrollRef}
        className={`overflow-x-auto scrollbar-none ${className}`}
      >
        {children}
      </div>
      {showRightFade && (
        <div
          className={`absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-gradient-to-l ${fadeFromLight} ${fadeFromDark} to-transparent`}
        />
      )}
    </div>
  );
}
