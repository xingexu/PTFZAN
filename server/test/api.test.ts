import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Stay } from '../../shared/guest/stay.js';

// No DATABASE_URL: the API saves to memory, so these tests never touch the real database.
vi.stubEnv('DATABASE_URL', '');
const { default: guest } = await import('../../api/guest.js');
const { default: activity } = await import('../../api/activity.js');

type Out = { status: number; data: { ok: boolean; stay?: Stay; message?: string; items?: { kind: string; text: string }[]; counts?: { registered: number; checkedIn: number } } };
const call = async (handler: typeof guest, method: string, url: string, body?: object): Promise<Out> => {
  const res = { statusCode: 0, body: '', setHeader: () => undefined, end(s: string) { this.body = s; } };
  await handler({ method, url, body } as never, res as never);
  return { status: res.statusCode, data: JSON.parse(res.body) };
};

describe('guest API', () => {
  let id = '';
  beforeAll(async () => {
    const r = await call(guest, 'POST', '/api/guest', { action: 'register', name: 'Ana Silva', party: 2 });
    expect(r.status).toBe(201);
    id = r.data.stay!.id;
  });

  it('saves a registration and reads it back', async () => {
    const r = await call(guest, 'GET', `/api/guest?id=${id}`);
    expect(r.data.stay).toMatchObject({ name: 'Ana Silva', party: 2 });
    expect(r.data.stay!.code).toMatch(/^FHN[A-Z2-9]{5}$/);
  });

  it('rejects bad input and unknown stays', async () => {
    expect((await call(guest, 'POST', '/api/guest', { action: 'register', name: '' })).status).toBe(400);
    expect((await call(guest, 'GET', '/api/guest?id=not-an-id')).status).toBe(404);
    expect((await call(guest, 'POST', '/api/guest', { action: 'hack', id })).status).toBe(400);
    expect((await call(guest, 'POST', '/api/guest', { action: 'issue', id, issue: 'AC not cooling' })).status).toBe(409);
  });

  it('checks the guest in and tells the hotel', async () => {
    const r = await call(guest, 'POST', '/api/guest', { action: 'check-in', id });
    expect(r.data.stay!.plan?.roomId).toMatch(/^[56]\d\d$/);
    const a = await call(activity, 'GET', '/api/activity?after=0');
    expect(a.data.items!.map((i) => i.kind)).toEqual(['check-in', 'register']);
    expect(a.data.counts).toEqual({ registered: 1, checkedIn: 1 });
    // Checking in twice changes nothing and isn't logged again.
    await call(guest, 'POST', '/api/guest', { action: 'check-in', id });
    expect((await call(activity, 'GET', '/api/activity?after=0')).data.items).toHaveLength(2);
  });

  it('deletes everything when the guest ends their stay', async () => {
    await call(guest, 'POST', '/api/guest', { action: 'end', id });
    expect((await call(guest, 'GET', `/api/guest?id=${id}`)).status).toBe(404);
    expect((await call(activity, 'GET', '/api/activity?after=0')).data.items).toHaveLength(0);
  });
});

describe('deadline', () => {
  it('answers 503 when the database stops responding, and ignores a reply that comes too late', async () => {
    const { send, withDeadline } = await import('../../api/_lib/http.js');
    let release!: () => void;
    const stuck = withDeadline(async (_req, res) => {
      await new Promise<void>((r) => (release = r));
      send(res, 200, { ok: true });
    }, 30);
    const res = { statusCode: 0, body: '', headersSent: false, setHeader: () => undefined, end(s: string) { this.body = s; this.headersSent = true; } };
    await stuck({ method: 'GET', url: '/api/hotel' } as never, res as never);
    expect(res.statusCode).toBe(503);
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(res.statusCode).toBe(503);
  });
});
