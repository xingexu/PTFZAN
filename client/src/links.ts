// Two views of one hotel: the hotel view (staff) and the guest view (the hotel's app).
// - Locally, the server hosts each on its own port and tells the page which one it is.
// - On Vercel, each is its own project: VITE_VIEW picks the view at build time, and
//   VITE_HOTEL_URL / VITE_GUEST_URL say where the other one lives.
// - With neither (Vite dev), both share one origin and the guest app lives under /guest.

export type View = 'hotel' | 'guest';

interface ViewLinks {
  view: View;
  hotel: string;
  guest: string;
  guestQr: string;
  /** Served by the local server, so the live text-message demo is available. */
  server?: boolean;
}

const injected = (window as unknown as { __FHN__?: ViewLinks }).__FHN__;
const here = window.location.origin;
const env = import.meta.env;
const trim = (u?: string) => (u ? u.replace(/\/$/, '') : undefined);

const view: View = injected?.view ?? (env.VITE_VIEW === 'guest' ? 'guest' : 'hotel');
const hotel = injected?.hotel ?? trim(env.VITE_HOTEL_URL) ?? here;
const guest = injected?.guest ?? trim(env.VITE_GUEST_URL) ?? here;

export const LINKS: ViewLinks = { view, hotel, guest, guestQr: injected?.guestQr ?? guest, server: injected?.server };

/** True when this tab is the guest view on its own site. */
export const isGuestView = view === 'guest';
/** True when the two views live on different sites (each in its own tab). */
export const separateSites = hotel !== guest;
/** The live text-message demo needs the local server. */
export const hasServer = !!injected?.server;

/** Where the guest app's pages live on this site. */
export const GUEST_BASE = isGuestView ? '' : '/guest';
export const guestPath = (path = '/') => `${GUEST_BASE}${path === '/' && GUEST_BASE ? '' : path}` || '/';
/** A link to the guest app, wherever it lives. */
export const guestUrl = (path = '/') => (separateSites ? LINKS.guest + path : here + guestPath(path));
export const hotelUrl = (path = '/') => (separateSites ? LINKS.hotel + path : here + path);
/** What a QR code should open: the guest app, reachable from a phone on the same network when served locally. */
export const guestQrUrl = () => (LINKS.guestQr !== LINKS.guest ? `${LINKS.guestQr}/` : guestUrl('/'));

/** Named tabs, so links from one view reuse the other view's tab where the browser allows it. */
export const GUEST_TAB = 'fhn-guest';
export const HOTEL_TAB = 'fhn-hotel';

// ───────── Staff session (a signed token from /api/auth, kept on this device) ─────────
const SESSION_KEY = 'fhn.session';
export const getSession = () => {
  try {
    return localStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
};
export const setSession = (token: string | null) => {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
};
/** The signed-in staff member, or null when the session is missing or has expired. The server checks the signature. */
export function sessionUser(): string | null {
  const token = getSession();
  try {
    const body = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))) as { u?: string; exp?: number };
    return body.u && body.exp && body.exp > Date.now() ? body.u : null;
  } catch {
    return null;
  }
}
