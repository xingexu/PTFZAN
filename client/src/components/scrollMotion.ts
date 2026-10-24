/** Reveal panels once as they enter, while leaving native wheel and touch scrolling intact. */
export function installScrollMotion() {
  if (!('IntersectionObserver' in window)) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet<Element>();
  const selector = '.page .card,.gx-card,.gx-list';
  const animations = new Set<Animation>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (reduced.matches || !entry.target.isConnected) continue;
      const animation = entry.target.animate([{ opacity: .55, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
      animations.add(animation);
      animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    }
  }, { threshold: .04 });
  const visit = (root: Element) => {
    const panels = [...root.querySelectorAll(selector)];
    if (root.matches(selector)) panels.push(root);
    for (const panel of panels) {
      if (seen.has(panel)) continue;
      seen.add(panel);
      // Already-visible panels enter with their page; only later panels reveal on scroll.
      if (panel.getBoundingClientRect().top >= window.innerHeight - 20) observer.observe(panel);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) visit(node);
      for (const node of record.removedNodes) if (node instanceof Element) {
        observer.unobserve(node);
        for (const panel of node.querySelectorAll(selector)) observer.unobserve(panel);
      }
    }
  }).observe(document.getElementById('root')!, { childList: true, subtree: true });
  reduced.addEventListener('change', () => { if (reduced.matches) for (const animation of animations) animation.cancel(); });
}
