const ACTIVE_KEY = 'fhn.guest.tab.v1';
const LEGACY_KEY = 'fhn.guest.id';
let current = '';
export function activeStayId() {
  try { return sessionStorage.getItem(ACTIVE_KEY) ?? current; } catch { return current; }
}
export function legacyStayId() {
  try { return localStorage.getItem(LEGACY_KEY) ?? ''; } catch { return ''; }
}
export function rememberStay(id: string | null) {
  current = id ?? '';
  try {
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* page-only access when browser storage is unavailable */ }
}
export const logOutGuest = () => rememberStay(null);
