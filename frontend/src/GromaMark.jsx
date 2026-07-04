/**
 * The Groma mark — a Roman surveying cross (rotated stadia arms with a
 * sighting point). One source of truth, used in header, footer, and states.
 */
export default function GromaMark({ size = 28, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(45 32 32)">
        <rect x="29.5" y="8" width="5" height="48" rx="2.5" fill="currentColor" opacity="0.92" />
        <rect x="8" y="29.5" width="48" height="5" rx="2.5" fill="currentColor" opacity="0.92" />
      </g>
      <circle cx="32" cy="32" r="7" fill="var(--color-bg, #FAF8F5)" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="2.4" fill="currentColor" />
    </svg>
  )
}
