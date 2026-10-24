import { useId } from 'react';

/** Wave lines inside the arch, rising to the right — as in the FHN mark from the case package. */
const WAVES = Array.from({ length: 12 }, (_, i) => {
  const y = 21.5 + i * 2.25;
  return `M-2 ${y}C10 ${y + 3.6} 18 ${y + 4.2} 24.5 ${y - 0.6}S33.5 ${y - 10} 42 ${y - 13.5}`;
}).join('');

/**
 * The Founders Hotel Network mark: a charcoal arch with a mint rim, filled low with flowing lines.
 * `tone="light"` keeps it readable on the dark glass the whole product uses.
 */
export function Logo({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'ink' }) {
  const clip = useId();
  const mint = tone === 'light' ? '#7fdccb' : '#4e9f93';
  return (
    <svg className={className} viewBox="0 0 40 48" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d="M3 46V20a17 17 0 0 1 34 0v26z" />
        </clipPath>
      </defs>
      <path d="M3 46V20a17 17 0 0 1 34 0v26z" fill="#232628" />
      <path d={WAVES} clipPath={`url(#${clip})`} fill="none" stroke={mint} strokeWidth="0.65" strokeLinecap="round" />
      <path d="M3 46V20a17 17 0 0 1 34 0v26z" fill="none" stroke={mint} strokeWidth="1.1" />
    </svg>
  );
}

/** Mark + wordmark, as on the case cover: "FHN" over "Founders Hotel Network". */
export function Brand({ sub, tone = 'light' }: { sub?: string; tone?: 'light' | 'ink' }) {
  return (
    <span className={`brand ${tone}`}>
      <Logo className="brand-mark" tone={tone} />
      <span className="brand-text">
        <span className="brand-name">FHN</span>
        <span className="brand-sub">{sub ?? 'Founders Hotel Network'}</span>
      </span>
    </span>
  );
}
