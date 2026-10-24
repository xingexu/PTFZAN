/** The FHN arch: a doorway with flowing lines, after the Founders Hotel Network mark. */
export function Logo({ className, tone = 'navy' }: { className?: string; tone?: 'navy' | 'light' }) {
  const arch = tone === 'navy' ? '#14213D' : '#FFFFFF';
  const wave = tone === 'navy' ? '#C9A46A' : '#E3C894';
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 28V14.5a9 9 0 0 1 18 0V28z" fill={arch} />
      <path d="M7 20.5c3.2-2 5.4 1.2 9-.9s5.7-1.9 9-.4M7 24.2c3.2-2 5.4 1.2 9-.9s5.7-1.9 9-.4" stroke={wave} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Logo + wordmark used in headers. */
export function Brand({ sub, tone = 'navy' }: { sub?: string; tone?: 'navy' | 'light' }) {
  return (
    <span className={`brand ${tone}`}>
      <Logo className="brand-mark" tone={tone} />
      <span className="brand-text">
        <span className="brand-name">Founders</span>
        {sub && <span className="brand-sub">{sub}</span>}
      </span>
    </span>
  );
}
