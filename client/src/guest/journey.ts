// A guest's stay, run on their own device. At check-in the wait is calculated from the same numbers the
// hotel model uses (room type clean time, place in the attendant's list, the final check), a window is
// promised, and each notification arrives when that moment comes — at demo pace, so a 45-minute clean
// takes a couple of minutes on screen. Everything is derived from timestamps, so a reload changes nothing.
import { useCallback, useEffect, useState } from 'react';
import { HIST_AVG, INSPECTION_MIN } from '../../../shared/sim/seed';
import type { GuestNotification, GuestRequest, GuestView, HousekeepingPref, Hvac, RoomStatus, RoomType } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';

/** Demo pace: one hotel minute passes in this many real seconds. */
export const SECONDS_PER_HOTEL_MINUTE = 2;
const STORE = 'fhn.guest.v1';
const GROUP = 'Chen–Okafor Wedding';
const PRECONDITION_MIN = 20;
const WALK_TO_ROOM_MIN = 8;
const TECH_TRAVEL_MIN = 20;
const FIX_MIN = 12;
const DELIVERY_MIN = 15;

const typeFor = (n: number): RoomType => (n <= 6 ? 'King' : n <= 10 ? 'Double Queen' : 'Suite');
const WEDDING_ROOMS = [5, 6].flatMap((floor) => Array.from({ length: 10 }, (_, i) => ({ id: `${floor}${String(i + 1).padStart(2, '0')}`, floor, type: typeFor(i + 1) })));

interface Plan {
  roomId: string;
  floor: number;
  type: RoomType;
  /** Hotel minutes. */
  queueMin: number;
  cleanMin: number;
  predictedMin: number;
  bandMin: number;
  position: number;
}

export interface Journey {
  code: string;
  name: string;
  email?: string;
  party: number;
  createdAt: number;
  checkInAt?: number;
  plan?: Plan;
  inRoomAt?: number;
  housekeeping: HousekeepingPref;
  setpoint: number;
  /** Epoch ms; the guest said they'd be back around then. */
  awayUntil?: number;
  notifyBrowser?: boolean;
  requests: { id: string; n: number; kind: 'issue' | 'amenity'; title: string; at: number }[];
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
const hm = (minutes: number) => minutes * SECONDS_PER_HOTEL_MINUTE * 1000;
/** Minutes since local midnight — the unit every time on the guest's screen uses. */
const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

function load(): Journey | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Journey) : null;
  } catch {
    return null;
  }
}
function save(j: Journey | null) {
  try {
    if (j) localStorage.setItem(STORE, JSON.stringify(j));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: the stay lasts for this page only */
  }
}

export const currentStay = () => load();

/** Registers a guest on this device. */
export function register(input: { name: string; email?: string; party: number }): Journey {
  const name = input.name.replace(/[<>]/g, '').trim().slice(0, 40) || 'Guest';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = `FHN${Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
  const j: Journey = { code, name, email: input.email?.trim() || undefined, party: Math.min(4, Math.max(1, input.party || 1)), createdAt: Date.now(), housekeeping: 'standard', setpoint: 21, requests: [] };
  save(j);
  return j;
}

export const endStay = () => save(null);

/**
 * The calculated wait: whatever the attendant is finishing first, then the room's own clean (the model's
 * average for that room type) and the final check. The window widens with the room's place in the list,
 * exactly as the hotel forecast does, and the guest is promised its late end.
 */
function planFor(code: string): Plan {
  const h = hash(code);
  const room = WEDDING_ROOMS[h % WEDDING_ROOMS.length];
  const position = 1 + ((h >>> 5) % 2);
  const queueMin = position === 1 ? 0 : 8 + ((h >>> 9) % 11);
  const predicted = queueMin + HIST_AVG[room.type] + INSPECTION_MIN;
  // How messy the room really is (the forecast never knows this): 92–110% of the average.
  const condition = 0.92 + ((h >>> 13) % 19) / 100;
  return {
    roomId: room.id,
    floor: room.floor,
    type: room.type,
    queueMin,
    cleanMin: Math.round(HIST_AVG[room.type] * condition),
    predictedMin: predicted,
    bandMin: Math.round(6 + 4 * Math.sqrt(position)),
    position,
  };
}

interface Timeline {
  start: number;
  cleanStart: number;
  inspectStart: number;
  ready: number;
  low: number;
  high: number;
  inRoom: number;
}
const timeline = (j: Journey): Timeline | null => {
  if (!j.checkInAt || !j.plan) return null;
  const p = j.plan;
  const t = (min: number) => j.checkInAt! + hm(min);
  const ready = t(p.queueMin + p.cleanMin + INSPECTION_MIN);
  return {
    start: j.checkInAt,
    cleanStart: t(p.queueMin),
    inspectStart: t(p.queueMin + p.cleanMin),
    ready,
    low: t(p.predictedMin - p.bandMin),
    high: t(p.predictedMin + p.bandMin),
    inRoom: j.inRoomAt ?? ready + hm(WALK_TO_ROOM_MIN),
  };
};

/** A promised time is rounded up to the minute, never down. */
const promise = (ms: number) => Math.ceil(minuteOfDay(ms));
const realMinutes = (hotelMin: number) => Math.max(1, Math.round((hotelMin * SECONDS_PER_HOTEL_MINUTE) / 60));

/** Everything the guest app shows at this moment. */
function viewOf(j: Journey, now: number): GuestView {
  const tl = timeline(j);
  const p = j.plan;
  const first = j.name.split(' ')[0];
  const inRoom = !!tl && now >= tl.inRoom;
  const notes: GuestNotification[] = [];
  const note = (id: string, at: number, kind: GuestNotification['kind'], title: string, body: string) => {
    if (now >= at) notes.push({ id, guestCode: j.code, at: minuteOfDay(at), kind, channel: 'push', title, body });
  };

  let status: RoomStatus = 'dirty';
  if (tl && p) {
    status = now >= tl.ready ? 'ready' : now >= tl.inspectStart ? 'inspection' : now >= tl.cleanStart ? 'cleaning' : 'dirty';
    note('eta', tl.start, 'eta', 'You’re checked in',
      `Hi ${first}, room ${p.roomId} will be ready by ${fmtTime(promise(tl.high))} — within ${Math.ceil((tl.high - tl.start) / 60000)} min. We’ll message you the moment it’s ready.`);
    if (p.queueMin > 0) note('clean', tl.cleanStart, 'info', 'Cleaning has started', `An attendant is cleaning room ${p.roomId} now.`);
    note('check', tl.inspectStart, 'info', 'Almost ready', `Cleaning is done — the final check is under way.`);
    const early = Math.round((tl.high - tl.ready) / 1000);
    note('ready', tl.ready, 'ready', `Room ${p.roomId} is ready`,
      `${first}, your room is ready${early > 0 ? ` — ${early} seconds before we promised` : ''}. Your mobile key is active; go straight up.`);
  }

  const requests: GuestRequest[] = j.requests.map((r) => {
    if (r.kind === 'issue') {
      const arrive = r.at + hm(TECH_TRAVEL_MIN);
      const fixed = arrive + hm(FIX_MIN);
      note(`rq${r.n}`, r.at, 'request', 'We’re on it', `Request #${r.n} for “${r.title}”: our maintenance technician will be at room ${p?.roomId} by ${fmtTime(minuteOfDay(arrive))}. No need to call.`);
      note(`rq${r.n}-done`, fixed, 'request', 'Fixed', `The “${r.title}” problem in room ${p?.roomId} is fixed. Thanks for your patience.`);
      return {
        id: r.id, guestCode: j.code, roomId: p?.roomId ?? '', kind: 'issue', title: r.title, openedAt: minuteOfDay(r.at), owner: 'Maintenance technician',
        etaAt: minuteOfDay(arrive), status: now >= fixed ? 'resolved' : now >= r.at + hm(TECH_TRAVEL_MIN * 0.6) ? 'on-the-way' : 'assigned',
        resolvedAt: now >= fixed ? minuteOfDay(fixed) : undefined, ticketId: `#${r.n}`, reports: 1,
      };
    }
    const done = r.at + hm(DELIVERY_MIN);
    note(`rq${r.n}`, r.at, 'request', 'On the way', `${r.title} will be at room ${p?.roomId} by ${fmtTime(minuteOfDay(done))}.`);
    note(`rq${r.n}-done`, done, 'request', 'Delivered', `${r.title} — delivered to room ${p?.roomId}.`);
    return {
      id: r.id, guestCode: j.code, roomId: p?.roomId ?? '', kind: 'amenity', title: r.title, openedAt: minuteOfDay(r.at), owner: `Housekeeping · floor ${p?.floor}`,
      etaAt: minuteOfDay(done), status: now >= done ? 'resolved' : now >= r.at + hm(DELIVERY_MIN * 0.5) ? 'on-the-way' : 'assigned',
      resolvedAt: now >= done ? minuteOfDay(done) : undefined, reports: 1,
    };
  });

  // Room temperature: energy saver while empty; back to the guest's temperature before they walk in.
  let hvac: Hvac = 'eco';
  if (inRoom) hvac = j.awayUntil && now < j.awayUntil ? (now >= j.awayUntil - hm(PRECONDITION_MIN) ? 'precool' : 'eco') : 'comfort';
  else if (tl && now >= tl.ready - hm(PRECONDITION_MIN)) hvac = 'precool';

  const today = new Date(j.checkInAt ?? j.createdAt);
  const day = (offset: number) => new Date(today.getTime() + offset * 86400000).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

  return {
    mode: 'ai',
    now: minuteOfDay(now),
    hotel: 'FHN Toronto Downtown',
    stay: { arrive: day(0), depart: day(2), nights: 2, confirmation: j.code },
    guest: {
      code: j.code, name: j.name, partySize: j.party, group: GROUP, state: inRoom ? 'checked-in' : tl ? 'informed-away' : 'expected', consentSms: false,
      notifyBrowser: !!j.notifyBrowser, phoneMasked: 'this phone', isDemoGuest: true, checkedInOnline: !!tl, canCheckIn: !tl, inRoom, housekeeping: j.housekeeping,
    },
    room: {
      id: p?.roomId ?? null,
      type: p?.type ?? 'King',
      status,
      eta: tl && p && status !== 'ready'
        ? {
            low: Math.floor(minuteOfDay(tl.low)),
            high: promise(tl.high),
            confidence: p.position === 1 ? 'high' : 'medium',
            drivers: [
              p.queueMin > 0 ? 'Next on an attendant’s list' : 'An attendant is starting on it now',
              `${p.type} rooms take about ${HIST_AVG[p.type]} minutes to clean`,
              `A ${INSPECTION_MIN}-minute final check`,
              `Shown at demo speed — ${p.predictedMin} hotel minutes take about ${realMinutes(p.predictedMin)} min here`,
            ],
          }
        : null,
      readyAt: tl && now >= tl.ready ? minuteOfDay(tl.ready) : null,
      floor: p?.floor ?? 5,
    },
    climate: { hvac, setpoint: j.setpoint, awayUntil: j.awayUntil ? minuteOfDay(j.awayUntil) : null },
    elevatorNotice: null,
    ticket: null,
    requests: requests.sort((a, b) => b.openedAt - a.openedAt),
    notifications: notes.sort((a, b) => b.at - a.at),
    delivery: {},
    progress: tl ? { startMs: tl.start, readyMs: tl.ready, highMs: tl.high, secondsPerMinute: SECONDS_PER_HOTEL_MINUTE } : undefined,
  };
}

/** What the guest can do. Returns a short confirmation, or throws with a reason. */
function apply(j: Journey, action: string, body: Record<string, unknown>, now: number): string {
  const tl = timeline(j);
  const inRoom = !!tl && now >= tl.inRoom;
  switch (action) {
    case 'check-in':
      if (j.checkInAt) return 'Already checked in';
      j.checkInAt = now;
      j.plan = planFor(j.code);
      return `Room ${j.plan.roomId}`;
    case 'unlock':
      if (!tl || now < tl.ready) throw new Error('Your key works the moment your room is ready.');
      j.inRoomAt ??= now;
      return `Room ${j.plan!.roomId} unlocked`;
    case 'issue':
    case 'request': {
      if (!inRoom) throw new Error('Available once you’re in your room.');
      const title = String(action === 'issue' ? body.issue : body.item).slice(0, 40);
      if (action === 'issue' && j.requests.some((r) => r.kind === 'issue' && r.title === title && now < r.at + hm(TECH_TRAVEL_MIN + FIX_MIN)))
        return 'Already reported — the technician has it';
      const n = 1043 + j.requests.length;
      j.requests.push({ id: `RQ-${n}`, n, kind: action === 'issue' ? 'issue' : 'amenity', title, at: now });
      return action === 'issue' ? `Request #${n} · maintenance technician` : `On the way by ${fmtTime(minuteOfDay(now + hm(DELIVERY_MIN)))}`;
    }
    case 'climate':
      if (typeof body.setpoint === 'number') j.setpoint = Math.min(25, Math.max(18, Math.round(body.setpoint)));
      if (body.awayMinutes === null) j.awayUntil = undefined;
      else if (typeof body.awayMinutes === 'number') j.awayUntil = now + hm(body.awayMinutes);
      return j.awayUntil ? `Saving energy · ${j.setpoint}°C by ${fmtTime(minuteOfDay(j.awayUntil))}` : `${j.setpoint}°C`;
    case 'housekeeping':
      if (!['standard', 'green', 'dnd'].includes(String(body.pref))) throw new Error('Unknown choice');
      j.housekeeping = body.pref as HousekeepingPref;
      return j.housekeeping === 'green' ? 'Tomorrow’s cleaning skipped — thank you!' : j.housekeeping === 'dnd' ? 'Do not disturb is on' : 'Daily cleaning is on';
    case 'prefs':
      j.notifyBrowser = !!body.notifyBrowser;
      return 'Saved';
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/** The guest's stay for React: re-derived every second so notifications land on time. */
export function useJourney() {
  const [journey, setJourney] = useState<Journey | null>(() => load());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const act = useCallback(
    (action: string, body: Record<string, unknown> = {}) => {
      const j = load() ?? journey;
      if (!j) throw new Error('Please register first.');
      const message = apply(j, action, body, Date.now());
      save(j);
      setJourney({ ...j });
      setNow(Date.now());
      return message;
    },
    [journey],
  );
  return { view: journey ? viewOf(journey, now) : null, act };
}

// Exposed for tests.
export const _internals = { planFor, viewOf, apply, timeline };
