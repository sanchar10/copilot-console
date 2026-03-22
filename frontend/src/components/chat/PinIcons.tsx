/**
 * Pin icons for pinnable / pinned messages and the drawer toggle.
 *
 * Unpinned: 📌 classic tilted pushpin (side view, ready to push)
 * Pinned:   Top-view pushpin — two concentric red circles (Concept B)
 */

interface PinIconProps {
  className?: string;
  size?: number;
}

/** Classic pushpin — side view with round head and pointed needle (📌 style) */
export function UnpinnedIcon({ className = '', size = 18 }: PinIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Needle — diagonal line from center to bottom-left */}
      <line x1="9.5" y1="14.5" x2="3" y2="21" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
      {/* Pin body — rotated rectangle */}
      <rect x="10" y="4" width="5" height="10" rx="1" transform="rotate(35, 12.5, 9)" fill="#f87171" />
      {/* Pin head — flat circular top */}
      <circle cx="14.5" cy="5.5" r="3.5" fill="#ef4444" />
      {/* Head highlight */}
      <circle cx="13.5" cy="4.5" r="1.5" fill="#fca5a5" opacity="0.6" />
    </svg>
  );
}

/** Top-view pushpin — pushed into board, two concentric circles (Concept B) */
export function PinnedIcon({ className = '', size = 18 }: PinIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" fill="#ef4444" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#dc2626" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="3" fill="#dc2626" />
    </svg>
  );
}
