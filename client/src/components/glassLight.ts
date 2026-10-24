// Liquid glass catches the light: the panel under the pointer (or finger) gets a highlight on its rim
// where the pointer is, like light moving across Apple's glass. Purely visual; one listener for the page.

const GLASS = '.glass, .card, .gx-card, .gx-list, .player, .hq-bar, .gx-tabs, .sheet';

export function installGlassLight() {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let lit: HTMLElement | null = null;
  let frame = 0;
  let last: PointerEvent | null = null;

  const clear = () => {
    lit?.style.removeProperty('--lx');
    lit?.style.removeProperty('--ly');
    lit?.classList.remove('lit');
    lit = null;
  };
  const apply = () => {
    frame = 0;
    if (!last) return;
    const el = (last.target as Element | null)?.closest?.(GLASS) as HTMLElement | null;
    if (el !== lit) clear();
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--lx', `${last.clientX - r.left}px`);
    el.style.setProperty('--ly', `${last.clientY - r.top}px`);
    el.classList.add('lit');
    lit = el;
  };
  const move = (e: PointerEvent) => {
    last = e;
    if (!frame) frame = requestAnimationFrame(apply);
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerdown', move, { passive: true });
  document.addEventListener('pointerleave', clear);
  window.addEventListener('blur', clear);
}
