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
 * Horizontally scrollable row with hidden scrollbar, fade-edge indicators,
 * and clickable chevron arrows for scroll navigation.
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
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateFades) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateFades);
      observer?.disconnect();
    };
  }, [updateFades]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div className="relative min-w-0 flex-1">
      {showLeftFade && (
        <div className={`absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r ${fadeFromLight} ${fadeFromDark} to-transparent flex items-center justify-start`}>
          <button
            onClick={() => scroll('left')}
            className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            aria-label="Scroll left"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className={`overflow-x-auto scrollbar-none ${className}`}
      >
        {children}
      </div>
      {showRightFade && (
        <div className={`absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l ${fadeFromLight} ${fadeFromDark} to-transparent flex items-center justify-end`}>
          <button
            onClick={() => scroll('right')}
            className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            aria-label="Scroll right"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
