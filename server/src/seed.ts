// Seed data for the Friday, October 16, 2026 scenario at the FHN Toronto property.
// Everything here is simulated, as the case permits.
import type { Attendant, Guest, Room, RoomType, ScenarioEvent } from '../../shared/types.js';

const t = (h: number, m = 0) => h * 60 + m;

/** Small deterministic PRNG so every run of the demo is identical. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const FLOORS = [3, 4, 5, 6];
export const SIM_START = t(8, 0);
export const SIM_END = t(17, 0);
export const GROUP = 'Chen–Okafor Wedding';

/** Historical average full-clean minutes by ROOM TYPE (never by person). */
export const HIST_AVG: Record<RoomType, number> = { King: 35, 'Double Queen': 39, Suite: 52 };
/** Ground-truth base minutes before room-condition variance. */
export const TRUE_BASE: Record<RoomType, number> = { King: 33, 'Double Queen': 37, Suite: 50 };
export const STAYOVER_MIN = 24;
export const INSPECTION_MIN = 6;
export const ELEVATOR_PENALTY = 6;

const typeFor = (n: number): RoomType => (n <= 6 ? 'King' : n <= 10 ? 'Double Queen' : 'Suite');

const FIRST = [
  'Amara', 'Ben', 'Chloé', 'Daniel', 'Elena', 'Farid', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kavya', 'Liam',
  'Maya', 'Noah', 'Olivia', 'Priya', 'Quinn', 'Rafael', 'Sofia', 'Theo', 'Uma', 'Victor', 'Wen', 'Yara',
  'Zoe', 'Aiden', 'Bianca', 'Caleb', 'Dina', 'Ethan', 'Fatima', 'Gabe',
];
const LAST = [
  'Chen', 'Okafor', 'Singh', 'Martin', 'Nguyen', 'Rossi', 'Kim', 'Haddad', 'Silva', 'Murphy', 'Tremblay',
  'Ali', 'Wong', 'Patel', 'Gagnon', 'Novak',
];

export interface Seed {
  rooms: Room[];
  guests: Guest[];
  attendants: Attendant[];
  events: ScenarioEvent[];
  /** Hidden per-room condition multiplier (how messy the room really is). */
  condition: Record<string, number>;
}

export function buildSeed(): Seed {
  const rand = rng(20261016);
  const rooms: Room[] = [];
  const condition: Record<string, number> = {};

  // Wedding block = floors 5 & 6, rooms 01–10 (20 rooms, 40 guests).
  // Departures in the block: when the outgoing guest actually leaves.
  const blockCheckout: Record<string, number | 'vacant'> = {
    '501': 'vacant', '502': t(8, 25), '503': t(9, 40), '504': t(11, 5), '505': t(12, 40),
    '506': t(10, 10), '507': 'vacant', '508': t(11, 0), '509': t(13, 0), '510': t(9, 5),
    '601': 'vacant', '602': t(8, 50), '603': t(10, 35), '604': t(11, 10), '605': t(9, 55),
    '606': t(12, 15), '607': t(11, 0), '608': t(10, 20), '609': t(8, 40), '610': t(11, 5),
  };
  const lateRooms = new Set(['505', '509', '606']);

  for (const floor of FLOORS) {
    for (let n = 1; n <= 12; n++) {
      const id = `${floor}${String(n).padStart(2, '0')}`;
      const type = typeFor(n);
      condition[id] = 0.9 + rand() * 0.42; // 0.90–1.32 → portfolio mean ≈ 38 min, matching the case
      const room: Room = { id, floor, type, status: 'ready' };

      if (floor >= 5 && n <= 10) {
        room.groupBlock = GROUP;
        room.arrivalId = `WED-${id}`;
        const co = blockCheckout[id];
        if (co === 'vacant') room.status = 'dirty';
        else {
          room.status = 'occupied';
          room.scheduledCheckout = t(11, 0);
          room.actualCheckout = co;
        }
        if (lateRooms.has(id)) room.lateReported = false;
      } else if (n <= 5) {
        // Stayovers on floors 3–4: guest leaves for the day, room needs light service.
        room.status = 'stayover';
        room.guestOutAt = t(8, 30) + Math.floor(rand() * 150);
      } else if (n <= 10) {
        // Regular departures on floors 3–4.
        room.status = 'occupied';
        room.scheduledCheckout = t(11, 0);
        room.actualCheckout = t(8, 45) + Math.floor(rand() * 150);
        if (n <= 8) room.arrivalId = `RES-${id}`; // 306–308, 406–408 have arrivals today
      } else if (floor >= 5) {
        // Suites 511/512/611/612: departing VIPs, arriving guests this evening.
        room.status = 'occupied';
        room.scheduledCheckout = t(12, 0);
        room.actualCheckout = t(10, 0) + Math.floor(rand() * 90);
        room.arrivalId = `RES-${id}`;
      }
      else if (n === 11) {
        // 311/411: suite stayovers.
        room.status = 'stayover';
        room.guestOutAt = t(9, 0) + Math.floor(rand() * 120);
      }
      // 312/412 stay vacant & ready — useful for room swaps.
      rooms.push(room);
    }
  }

  // Guests
  const guests: Guest[] = [];
  let nameIdx = 0;
  const nextName = () => {
    const f = FIRST[nameIdx % FIRST.length];
    const l = LAST[(nameIdx * 7 + 3) % LAST.length];
    nameIdx++;
    return `${f} ${l}`;
  };
  const blockRooms = rooms.filter((r) => r.groupBlock);
  blockRooms.forEach((r, i) => {
    // Wedding parties arrive in a wave between 14:45 and 15:40.
    const arrival = t(14, 45) + Math.round((i / (blockRooms.length - 1)) * 55);
    guests.push({
      code: `WED${r.id}`,
      name: nextName(),
      partySize: 2,
      roomId: r.id,
      group: GROUP,
      arrivalTime: arrival,
      expectedArrival: t(17, 0), // before 13:15 the block was expected after the ceremony
      state: 'expected',
      consentSms: !['WED508', 'WED604'].includes(`WED${r.id}`), // two guests declined texts (PIPEDA)
      phoneMasked: `(416) •••-${String(1200 + i * 37).slice(-4)}`,
      notifyBrowser: false,
      lobbyMinutes: 0,
    });
  });
  for (const r of rooms.filter((x) => x.arrivalId?.startsWith('RES-'))) {
    const isSuite = r.type === 'Suite';
    const arrival = isSuite ? t(16, 30) + Math.floor(rand() * 25) : t(15, 20) + Math.floor(rand() * 70);
    guests.push({
      code: `RES${r.id}`,
      name: nextName(),
      partySize: 1 + Math.floor(rand() * 2),
      roomId: r.id,
      arrivalTime: arrival,
      expectedArrival: isSuite ? t(16, 30) : t(16, 0),
      state: 'expected',
      consentSms: true,
      phoneMasked: `(647) •••-${String(3000 + Number(r.id)).slice(-4)}`,
      notifyBrowser: false,
      lobbyMinutes: 0,
    });
  }

  // Four attendants scheduled (one per floor); Attendant 3 calls in sick at 08:00.
  const attendants: Attendant[] = [1, 2, 3, 4].map((n) => ({
    id: `A${n}`,
    label: `Attendant ${n}`,
    present: true,
    queue: [],
    busyUntil: SIM_START + 30, // shift briefing until 08:30
    lastFloor: n + 2,
    activity: 'Shift briefing',
    breakAt: n % 2 === 0 ? t(12, 0) : t(12, 30),
    hadBreak: false,
    wastedVisits: 0,
  }));

  const events: ScenarioEvent[] = [
    { at: t(8, 0), id: 'absence', title: 'Sick call', detail: 'Attendant 3 calls in sick after the day’s assignments were issued.' },
    { at: t(10, 30), id: 'late', title: 'Late checkouts', detail: 'Rooms 505, 509 and 606 request late checkout (12:15–13:00).' },
    { at: t(12, 0), id: 'elevator', title: 'Elevator B out', detail: 'Carts and guests share one elevator. Floors 5–6 slow down.' },
    { at: t(13, 15), id: 'group', title: 'Wedding moves to 3 PM', detail: 'The Chen–Okafor party (20 rooms, 40 guests) now arrives ~3:00 PM, not after 5:00 PM.' },
    { at: t(14, 45), id: 'arrivals', title: 'Arrivals begin', detail: 'The wedding party begins to arrive at the front desk.' },
    { at: t(15, 45), id: 'checkpoint', title: 'Checkpoint', detail: 'The moment the real incident escalated to the duty manager.' },
  ];

  return { rooms, guests, attendants, events, condition };
}

export const TIME = t;
