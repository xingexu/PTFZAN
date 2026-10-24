import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), values };
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('sessionStorage', storage()); vi.stubGlobal('localStorage', storage()); });
afterEach(() => vi.unstubAllGlobals());

describe('guest access lifecycle', () => {
  it('does not automatically open a stay saved by an earlier version', async () => {
    localStorage.setItem('fhn.guest.id', 'old-private-code');
    const access = await import('../../client/src/guest/access');
    expect(access.activeStayId()).toBe('');
    expect(access.legacyStayId()).toBe('old-private-code');
  });
  it('keeps access through a refresh in the same tab, but not a fresh tab', async () => {
    const access = await import('../../client/src/guest/access');
    access.rememberStay('private-stay-code');
    vi.resetModules();
    expect((await import('../../client/src/guest/access')).activeStayId()).toBe('private-stay-code');
    vi.stubGlobal('sessionStorage', storage());
    vi.resetModules();
    expect((await import('../../client/src/guest/access')).activeStayId()).toBe('');
    expect(localStorage.getItem('fhn.guest.id')).toBeNull();
  });
  it('logout forgets access without making a destructive request', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const access = await import('../../client/src/guest/access');
    access.rememberStay('private-stay-code');
    access.logOutGuest();
    expect(access.activeStayId()).toBe('');
    expect(network).not.toHaveBeenCalled();
  });
});

describe('admin tab access', () => {
  it('starts signed out, persists in the current tab, and clears on logout', async () => {
    const session = await import('../../client/src/session');
    expect(session.adminHeaders()).toEqual({});
    session.startAdminTab();
    const key = session.adminTabKey();
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    vi.resetModules();
    expect((await import('../../client/src/session')).adminTabKey()).toBe(key);
    session.clearAdminTab();
    expect(session.adminHeaders()).toEqual({});
  });
});
