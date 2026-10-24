import { flushSync } from 'react-dom';

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };

/**
 * Cross-fades the screen while `update` changes it (a view transition where the browser has them),
 * so switching modes, layers or people never jumps. The update itself always runs.
 */
export function fade(update: () => void) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  const t = doc.startViewTransition(() => flushSync(update));
  t.ready.catch(() => undefined);
  t.finished.catch(() => undefined);
}
