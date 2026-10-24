// One site, with guest access under /guest and the hotel workspace under /overview.
// Legacy VITE_VIEW / VITE_*_URL settings no longer split the app into separate sites.
const injected = (window as unknown as { __FHN__?: { server?: boolean; guestQr?: string } }).__FHN__;

/** The live text-message demo needs the local server. */
export const hasServer = !!injected?.server;
export const guestPath = (path = '/') => `/guest${path === '/' ? '' : path}`;
export const guestUrl = (path = '/') => window.location.origin + guestPath(path);
/** On the local server, let phones reach the same site over Wi-Fi. */
export const guestQrUrl = () => (injected?.guestQr ?? window.location.origin) + guestPath();
