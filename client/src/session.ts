// Access lasts for this tab only. Nothing here is saved to localStorage.
const ADMIN_KEY = 'fhn.admin.tab.v1';
let fallback = '';
export function adminTabKey() {
  try { return sessionStorage.getItem(ADMIN_KEY) ?? fallback; } catch { return fallback; }
}
export function startAdminTab() {
  fallback = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(ADMIN_KEY, fallback); } catch { /* page-only session */ }
}
export function clearAdminTab() {
  fallback = '';
  try { sessionStorage.removeItem(ADMIN_KEY); } catch { /* page-only session */ }
}
export const adminHeaders = (): Record<string, string> => adminTabKey() ? { 'x-fhn-session': adminTabKey() } : {};
