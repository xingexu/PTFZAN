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
export const IN_HOUSE_CODE = 'STAY411';

/** Room HVAC draw (kWh per room-hour) at full comfort vs eco setback. Planning assumptions for a PTAC/fan-coil room. */
export const KW_RUNNING = 0.9;
export const KW_ECO = 0.25;

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
      const room: Room = { id, floor, type, status: 'ready', hvac: 'comfort' };

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
        if (id === '302' || id === '404') room.serviced = true; // "Do not disturb" all day — no service
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
    // Exhibit 4: wedding guests begin arriving at 15:00; all 40 are in the lobby by 15:45.
    const arrival = t(15, 0) + Math.round((i / (blockRooms.length - 1)) * 40);
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
      housekeeping: 'standard',
      setpoint: 21,
    });
  });
  for (const r of rooms.filter((x) => x.arrivalId?.startsWith('RES-'))) {
    const isSuite = r.type === 'Suite';
    // Suites check in this evening, after the 08:00–17:00 shift record; other rooms from 15:20.
    const arrival = isSuite ? t(17, 30) + Math.floor(rand() * 60) : t(15, 20) + Math.floor(rand() * 70);
    guests.push({
      code: `RES${r.id}`,
      name: nextName(),
      partySize: 1 + Math.floor(rand() * 2),
      roomId: r.id,
      arrivalTime: arrival,
      expectedArrival: isSuite ? t(18, 0) : t(16, 0),
      state: 'expected',
      consentSms: true,
      phoneMasked: `(647) •••-${String(3000 + Number(r.id)).slice(-4)}`,
      notifyBrowser: false,
      lobbyMinutes: 0,
      housekeeping: 'standard',
      setpoint: 21,
    });
  }
  // An in-house guest (411, a suite stayover). Back from meetings at 2 PM — when their AC fails.
  guests.push({
    code: IN_HOUSE_CODE,
    name: 'Noor Haddad',
    partySize: 1,
    roomId: '411',
    arrivalTime: t(14, 0),
    expectedArrival: t(14, 0),
    state: 'checked-in',
    consentSms: true,
    phoneMasked: '(905) •••-0411',
    notifyBrowser: false,
    lobbyMinutes: 0,
    inHouse: true,
    housekeeping: 'standard',
    setpoint: 21,
  });

  // Four attendants scheduled (one per floor) plus one on call; Attendant 3 calls in sick at 08:00 (Exhibit 4).
  const attendants: Attendant[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `A${n}`,
    label: n === 5 ? 'Backup attendant' : `Attendant ${n}`,
    present: n !== 5,
    onCall: n === 5,
    queue: [],
    busyUntil: SIM_START + 30, // shift briefing until 08:30
    lastFloor: [3, 4, 5, 6, 5][n - 1],
    activity: n === 5 ? 'On call — not booked' : 'Shift briefing',
    breakAt: n === 5 ? t(13, 30) : n % 2 === 0 ? t(12, 0) : t(12, 30),
    hadBreak: false,
    wastedVisits: 0,
    wastedMin: 0,
  }));

  // Exhibit 4 — the Toronto property's shift record, 08:00–17:00, verbatim times.
  const events: ScenarioEvent[] = [
    { at: t(8, 0), id: 'absence', title: 'Absence', detail: 'Employee absence reported after assignments are issued.' },
    { at: t(10, 30), id: 'late', title: 'Late checkouts', detail: 'Late checkouts recorded (505, 509, 606).' },
    { at: t(12, 0), id: 'elevator', title: 'Elevator out', detail: 'Elevator taken out of service. Carts and guests share the remaining elevator.' },
    { at: t(13, 15), id: 'group', title: 'Wedding at 3', detail: 'The wedding group confirms arrivals around 15:00 (20 rooms, 40 guests).' },
    { at: t(14, 30), id: 'calls', title: 'Calls', detail: 'Calls made for readiness updates.' },
    { at: t(15, 0), id: 'arrivals', title: 'Arrivals', detail: 'Wedding guests begin arriving.' },
    { at: t(15, 45), id: 'checkpoint', title: 'Checkpoint', detail: 'Today: 40 guests waiting, 12 rooms still being prepared — escalated to the duty manager.' },
    { at: t(17, 0), id: 'release', title: 'Shift ends', detail: 'Remaining group rooms released; check-in queue clears; elevator fault still open.' },
  ];


  return { rooms, guests, attendants, events, condition };
}

export const TIME = t;

/**
 * Maintenance history exactly as it lives today: free-text spreadsheet rows, typed by different people.
 * The prototype normalises these with keyword rules; the pilot uses an LLM with a fixed output schema.
 */
export const MAINTENANCE_HISTORY: { date: string; raw: string }[] = [
  { date: '2026-08-14', raw: 'TV 306 no signal - reseated cable' },
  { date: '2026-08-21', raw: 'rm 411 ac not cold, reset breaker' },
  { date: '2026-08-24', raw: 'Elev B door sensor fault, reset by contractor' },
  { date: '2026-08-29', raw: 'Ice machine fl 4 leaking onto carpet' },
  { date: '2026-09-09', raw: '411 PTAC no cooling - cleaned filter' },
  { date: '2026-09-14', raw: "elevator b - door won't close fl 5" },
  { date: '2026-09-18', raw: '509 shower drain slow' },
  { date: '2026-09-25', raw: 'Rm 612 heat not working, thermostat replaced' },
  { date: '2026-09-30', raw: 'Guest in 411 says room warm, AC fan only' },
  { date: '2026-10-02', raw: 'slow drain bathtub 509, snaked' },
  { date: '2026-10-05', raw: 'ELEV-B door reopening repeatedly, guests stuck 2 min' },
  { date: '2026-10-09', raw: 'Lobby door closer squeaking' },
];
export const HISTORY_AS_OF = '2026-10-16';

/** Tomorrow (Sat, Oct 17) from the PMS: the wedding block stays over, other rooms turn. */
export const TOMORROW = {
  date: 'Sat, Oct 17',
  departures: 16,
  stayovers: 26, // 20 wedding rooms + 6 stayovers
  arrivals: 14,
  /** Weekend schedule as posted today. */
  scheduled: 3,
  /** When the work lands: share of departures checking out and of stayovers serviced in each block. */
  blocks: [
    { label: '8–11 AM', hours: 3, departShare: 0.3, stayShare: 0.4 },
    { label: '11 AM–3 PM', hours: 4, departShare: 0.55, stayShare: 0.5 },
    { label: '3–5 PM', hours: 2, departShare: 0.15, stayShare: 0.1 },
  ],
};
