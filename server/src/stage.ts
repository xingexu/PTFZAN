// Stage mode: one scripted guest ("Mike") whose room-ready text is triggered on cue during the pitch.
// Deliberately independent of the simulation clock, so the moment can never be spoiled by the sim
// having already marked the room ready.
import { timingSafeEqual } from 'node:crypto';
import type { GuestNotification, GuestView, NotificationKind, RoomType, StageState } from '../../shared/types.js';
import { fmtRange } from '../../shared/types.js';
import type { Messenger } from './messaging.js';
import { maskPhone, normalizePhone } from './phone.js';

export const STAGE_CODE = 'MIKE';
const DEBOUNCE_MS = 1500;

const roomType = (id: string): RoomType => {
  const n = Number(id.slice(-2));
  return n <= 6 ? 'King' : n <= 10 ? 'Double Queen' : 'Suite';
};

export function minutesInZone(timeZone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export interface StageOptions {
  name: string;
  room: string;
  phone?: string;
  pin?: string;
  timeZone: string;
}

export class Stage {
  private name: string;
  private roomId: string;
  private phone: string | null;
  private step: StageState['step'] = 'booked';
  private eta: StageState['eta'] = null;
  private checkedInAt: number | null = null;
  private readyAt: number | null = null;
  private messages: GuestNotification[] = [];
  private sendReal = true;
  private lastCueAt: number | null = null;
  private seq = 0;

  constructor(
    private messenger: Messenger,
    private opts: StageOptions,
    private onChange: () => void = () => undefined,
  ) {
    this.name = opts.name;
    this.roomId = opts.room;
    this.phone = opts.phone ? normalizePhone(opts.phone) : null;
    if (opts.phone && !this.phone) console.warn('STAGE_PHONE is not a valid phone number — ignoring it.');
  }

  get pinRequired() {
    return !!this.opts.pin;
  }
  checkPin(pin: string | undefined) {
    if (!this.opts.pin) return true;
    const a = Buffer.from(String(pin ?? ''));
    const b = Buffer.from(this.opts.pin);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  private now() {
    return minutesInZone(this.opts.timeZone);
  }

  // ───────────────────────── actions ─────────────────────────
  reset() {
    this.step = 'booked';
    this.eta = null;
    this.checkedInAt = null;
    this.readyAt = null;
    this.messages = [];
    this.lastCueAt = null;
    this.onChange();
  }

  configure(input: { name?: string; phone?: string; room?: string }): { ok: boolean; message: string } {
    if (input.name !== undefined) {
      const n = input.name.replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 24);
      if (!n) return { ok: false, message: 'Please enter a first name.' };
      this.name = n;
    }
    if (input.room !== undefined) {
      if (!/^[2-9]\d{2}$/.test(input.room.trim())) return { ok: false, message: 'Room must be a 3-digit number like 504.' };
      this.roomId = input.room.trim();
    }
    if (input.phone !== undefined) {
      if (input.phone.trim() === '') this.phone = null;
      else {
        const p = normalizePhone(input.phone);
        if (!p) return { ok: false, message: 'That doesn’t look like a valid phone number.' };
        this.phone = p;
      }
    }
    this.onChange();
    return { ok: true, message: 'Saved.' };
  }

  setSendReal(v: boolean) {
    this.sendReal = v;
    this.onChange();
  }

  /** Advance one step: booked → checked in (ETA text) → ready (ready text). Debounced against double presses. */
  next(origin?: string): { ok: boolean; message: string } {
    if (this.lastCueAt && Date.now() - this.lastCueAt < DEBOUNCE_MS) return { ok: false, message: 'Ignored a double press.' };
    if (this.step === 'booked') return this.checkIn(origin);
    if (this.step === 'checked-in') return this.markReady(origin);
    return { ok: false, message: 'Room is already ready. Reset to run it again.' };
  }

  checkIn(origin?: string): { ok: boolean; message: string } {
    if (this.step !== 'booked') return { ok: false, message: 'Already checked in.' };
    this.lastCueAt = Date.now();
    const now = this.now();
    // Quote a 15-minute window starting ~15 minutes out, on 5-minute boundaries. We promise the late end.
    const low = Math.ceil((now + 15) / 5) * 5;
    this.eta = { low, high: low + 15 };
    this.checkedInAt = now;
    this.step = 'checked-in';
    const first = this.name;
    const range = fmtRange(this.eta.low, this.eta.high);
    const how = this.notify(
      'eta',
      `You're checked in, ${first}`,
      `Hi ${first}, you're checked in. Room ${this.roomId} will be ready ${range} — we'll text you the second it's ready.`,
      `FHN Toronto: Hi ${first}, you're checked in. Room ${this.roomId} will be ready ${range} - we'll text you the second it's ready.`,
      origin,
    );
    return { ok: true, message: `ETA text: ${range} (${how}).` };
  }

  markReady(origin?: string): { ok: boolean; message: string } {
    if (this.step === 'ready') return { ok: false, message: 'Already ready.' };
    this.lastCueAt = Date.now();
    this.readyAt = this.now();
    this.step = 'ready';
    const first = this.name;
    const how = this.notify(
      'ready',
      `Room ${this.roomId} is ready`,
      `${first}, your room ${this.roomId} is ready! Skip the front desk — your mobile key is active. Welcome to FHN.`,
      `FHN Toronto: ${first}, your room ${this.roomId} is ready! Skip the front desk - your mobile key is active. Welcome to FHN.`,
      origin,
    );
    return { ok: true, message: `Room-ready text (${how}).` };
  }

  /** Rehearsal check that the phone really receives messages. Does not change the scene. */
  test(origin?: string): { ok: boolean; message: string } {
    const rec = this.messenger.send({
      guestCode: STAGE_CODE,
      kind: 'test',
      to: this.phone,
      title: 'ReadyPath test',
      body: 'FHN Toronto: Test message - ReadyPath is connected to this phone.',
      clickUrl: origin ? `${origin}/guest/${STAGE_CODE}` : undefined,
      audience: 'stage',
      simulate: !this.sendReal,
    });
    this.onChange();
    return { ok: true, message: rec.provider === 'simulated' ? 'Test simulated (no real message sent).' : `Test sent via ${rec.provider}.` };
  }

  /** Records the message for the guest page and sends it. Returns a short description of how it went out. */
  private notify(kind: NotificationKind, title: string, body: string, sms: string, origin?: string): string {
    const n: GuestNotification = { id: `S-${++this.seq}`, guestCode: STAGE_CODE, at: this.now(), kind, channel: 'sms', title, body };
    this.messages.unshift(n);
    const rec = this.messenger.send({
      guestCode: STAGE_CODE,
      notificationId: n.id,
      kind,
      to: this.phone,
      title,
      body: sms,
      clickUrl: origin ? `${origin}/guest/${STAGE_CODE}` : undefined,
      audience: 'stage',
      simulate: !this.sendReal,
    });
    this.onChange();
    if (rec.provider === 'twilio') return `SMS to ${rec.toMasked}`;
    if (rec.provider === 'httpsms') return `SMS from your phone ${rec.from} to ${rec.toMasked}`;
    if (rec.provider === 'mac') return `Messages app to ${rec.toMasked}`;
    if (rec.provider === 'ntfy') return 'push via ntfy';
    return this.sendReal ? 'simulated — no messaging configured' : 'rehearsal — nothing sent';
  }

  // ───────────────────────── views ─────────────────────────
  state(): StageState {
    return {
      guestCode: STAGE_CODE,
      name: this.name,
      roomId: this.roomId,
      roomType: roomType(this.roomId),
      floor: Number(this.roomId.slice(0, -2)),
      step: this.step,
      roomStatus: this.step === 'ready' ? 'ready' : 'cleaning',
      eta: this.eta,
      checkedInAt: this.checkedInAt,
      readyAt: this.readyAt,
      now: this.now(),
      phoneMasked: this.phone ? maskPhone(this.phone) : null,
      sendReal: this.sendReal,
      pinRequired: this.pinRequired,
      messages: this.messages,
      deliveries: this.messenger.records.filter((r) => r.guestCode === STAGE_CODE).slice(0, 12),
      messaging: this.messenger.status,
      lastCueAt: this.lastCueAt,
    };
  }

  guestView(): GuestView {
    const ready = this.step === 'ready';
    const delivery: GuestView['delivery'] = {};
    for (const r of this.messenger.records) {
      if (r.guestCode === STAGE_CODE && r.notificationId && !delivery[r.notificationId]) delivery[r.notificationId] = { status: r.status, provider: r.provider, error: r.error };
    }
    return {
      mode: 'readypath',
      now: this.now(),
      hotel: 'FHN Toronto Downtown',
      guest: {
        code: STAGE_CODE,
        name: this.name,
        partySize: 1,
        state: ready ? 'informed-away' : this.step === 'checked-in' ? 'informed-away' : 'expected',
        consentSms: !!this.phone,
        notifyBrowser: true,
        phoneMasked: this.phone ? maskPhone(this.phone) : 'This page',
        isDemoGuest: true,
      },
      room: {
        id: this.roomId,
        type: roomType(this.roomId),
        status: ready ? 'ready' : 'cleaning',
        eta:
          !ready && this.eta
            ? { low: this.eta.low, high: this.eta.high, confidence: 'high', drivers: ['Previous guest checked out', `${roomType(this.roomId)} average 35 min`, 'Attendant cleaning now'] }
            : null,
        readyAt: this.readyAt,
        floor: Number(this.roomId.slice(0, -2)),
      },
      elevatorNotice: null,
      ticket: null,
      notifications: this.messages,
      delivery,
    };
  }

}
