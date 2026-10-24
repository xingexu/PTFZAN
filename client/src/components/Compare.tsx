import { useEffect, useRef, useState } from 'react';

/** Eases a number toward its new value so changes read as motion, not jumps. */
export function useTween(target: number, ms = 450) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = start + (target - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(value);
}

export function Num({ value }: { value: number }) {
  return <>{useTween(value)}</>;
}

/**
 * Today's way and FHN AI as two bars on the same scale. A side with no number yet shows `open`
 * (e.g. "still broken").
 */
export function CompareBars({ today, ai, unit = '', open = '—' }: { today?: number | null; ai?: number | null; unit?: string; open?: string }) {
  const max = Math.max(1, today ?? 0, ai ?? 0);
  const row = (v: number | null | undefined, who: 'today' | 'ai') => (
    <div className={`cb ${who} ${v == null ? 'open' : ''}`}>
      <span className="cb-who">{who === 'ai' ? 'FHN AI' : 'Today'}</span>
      <span className="cb-track">
        <i style={{ width: `${v == null ? 100 : Math.max(2, (v / max) * 100)}%` }} />
      </span>
      <span className="cb-val">
        {v == null ? (
          <small>{open}</small>
        ) : (
          <>
            <Num value={v} />
            {unit && <small>{unit}</small>}
          </>
        )}
      </span>
    </div>
  );
  return (
    <div className="cbars">
      {row(today, 'today')}
      {row(ai, 'ai')}
    </div>
  );
}
