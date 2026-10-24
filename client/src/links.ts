// Two views of one live hotel: the hotel view (staff) and the guest view (the hotel's app).
// Locally they run on two ports so each opens in its own tab; the server tells each page which
// view it is and where the other one lives. Without that (Vite dev, single public URL) both share one origin.

export type View = 'hotel' | 'guest';

interface ViewLinks {
  view: View;
  hotel: string;
  guest: string;
  guestQr: string;
}

const injected = (window as unknown as { __FHN__?: ViewLinks }).__FHN__;
const here = window.location.origin;

export const LINKS: ViewLinks = injected ?? { view: 'hotel', hotel: here, guest: here, guestQr: here };

/** True when this tab is the guest view on its own port. */
export const isGuestView = LINKS.view === 'guest';
/** True when the two views live on different origins (each in its own tab). */
export const separateTabs = LINKS.hotel !== LINKS.guest;

export const guestUrl = (path = '/app') => LINKS.guest + path;
export const hotelUrl = (path = '/') => LINKS.hotel + path;

/** Named tabs, so links from one view reuse the other view's tab where the browser allows it. */
export const GUEST_TAB = 'fhn-guest';
export const HOTEL_TAB = 'fhn-hotel';
