import { useLayoutEffect, useRef } from 'react';

/**
 * A glass "lens" that slides to the selected item of a tab bar or segmented control, as in iOS.
 * The container gets `--ix --iy --iw --ih` for its `::before`; the first placement doesn't animate.
 * `key` is whatever decides the selection (the route, the tab, the mode).
 */
export function useSlide<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('.active, .on, [aria-current="page"]');
      el.style.setProperty('--io', on ? '1' : '0');
      if (!on) return;
      el.style.setProperty('--ix', `${on.offsetLeft}px`);
      el.style.setProperty('--iy', `${on.offsetTop}px`);
      el.style.setProperty('--iw', `${on.offsetWidth}px`);
      el.style.setProperty('--ih', `${on.offsetHeight}px`);
    };
    place();
    const ready = requestAnimationFrame(() => (el.dataset.slide = 'ready'));
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(ready);
      ro.disconnect();
    };
  }, [key]);
  return ref;
}
