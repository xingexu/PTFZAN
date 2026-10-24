/** The hotel name is the wordmark; no separate symbol or initials. */
export function Brand({ sub, tone = 'ink' }: { sub?: string; tone?: 'light' | 'ink' }) {
  return (
    <span className={`brand ${tone}`}>
      <span className="brand-text">
        <span className="brand-name">Founders Hotel Network</span>
        {sub && <span className="brand-sub">{sub}</span>}
      </span>
    </span>
  );
}
