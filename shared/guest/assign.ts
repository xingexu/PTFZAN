// FHN AI's check-in decision, made on the server. When a guest checks in on their phone, the room that needs
// cleaning for them goes to the closest attendant — the one who can be at its door soonest from wherever they
// are — and the hotel picks the room that will be ready soonest that way, given every other guest who is already
// waiting (read from the database). The server makes one decision at a time, under a lock, so two
// guests checking in together never get the same room or the same place in an attendant's list.
// Pure functions only: the store supplies the other guests, the API saves the result.
import { distanceWords, walkMin, type Spot } from '../sim/layout.js';
import { HIST_AVG, INSPECTION_MIN } from '../sim/seed.js';
import type { RoomType } from '../types.js';
import { hm, type Plan, type Stay } from './stay.js';

/** A checked-in guest keeps their room this long (a demo stay), then it can be given out again. */
export const HOLD_MS = 4 * 3600_000;

const typeFor = (n: number): RoomType => (n <= 6 ? 'King' : n <= 10 ? 'Double Queen' : 'Suite');
interface Room {
  id: string;
  floor: number;
  type: RoomType;
  /** Part of the wedding block (floors 5–6, rooms 01–10). */
  block: boolean;
}
const ROOMS: Room[] = [5, 6, 3, 4].flatMap((floor) =>
  Array.from({ length: 12 }, (_, i) => ({ id: `${floor}${String(i + 1).padStart(2, '0')}`, floor, type: typeFor(i + 1), block: floor >= 5 && i < 10 })),
);

/**
 * Who cleans for guests checking in: the Oct 16 team (Attendant 3 is off sick; the backup covers floor 5).
 * `at` is where each starts — their floor's elevator lobby — until they've been sent to a room.
 */
export const TEAM: { id: string; name: string; at: Spot }[] = [
  { id: 'A4', name: 'Attendant 4', at: 6 },
  { id: 'A5', name: 'Backup attendant', at: 5 },
  { id: 'A1', name: 'Attendant 1', at: 3 },
  { id: 'A2', name: 'Attendant 2', at: 4 },
];

/** A room another guest already has, and when its attendant is busy with it. */
interface Booked {
  roomId: string;
  attendant?: string;
  /** When the attendant really finishes it, and when the forecast expected them to. */
  endMs: number;
  forecastEndMs: number;
}
type Other = Pick<Stay, 'checkInAt' | 'plan'>;

function booked(o: Other): Booked | null {
  if (!o.checkInAt || !o.plan) return null;
  const p = o.plan;
  return {
    roomId: p.roomId,
    attendant: p.attendantId,
    endMs: o.checkInAt + hm(p.queueMin + p.cleanMin),
    forecastEndMs: o.checkInAt + hm(p.predictedMin - INSPECTION_MIN),
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
const roomWord = (n: number) => `${n} room${n === 1 ? '' : 's'}`;

/**
 * Chooses a room and an attendant for a guest checking in at `now`. Every free room is paired with every
 * attendant; the pair with the earliest forecast ready time wins (the wedding block first, and a room the
 * party's size suits). The forecast uses the hotel model's numbers — each room type's average clean time, the
 * final check, the attendant's list and the walk there — and the window widens with the room's place in that
 * list, as the hotel forecast does. How long the clean really takes (the room's condition) the forecast can't
 * know; it is fixed per guest so the server and the phone agree on it.
 */
export function chooseRoom(guest: { code: string; party: number }, now: number, others: Other[]): Plan {
  const taken = others.map(booked).filter((b): b is Booked => !!b);
  const held = new Set(taken.map((b) => b.roomId));
  const fits = (r: Room) => guest.party <= 2 || r.type !== 'King';
  let pool = ROOMS.filter((r) => r.block && fits(r) && !held.has(r.id));
  const blockFull = pool.length === 0;
  if (blockFull) pool = ROOMS.filter((r) => fits(r) && !held.has(r.id));
  if (!pool.length) pool = ROOMS.filter(fits); // every room is taken: a demo never stops, the first fitting room is shared

  const team = TEAM.map((a) => {
    const mine = taken.filter((b) => b.attendant === a.id).sort((x, y) => x.endMs - y.endMs);
    const busy = mine.filter((b) => b.endMs > now);
    return {
      ...a,
      // Where they are (or will be): the last room they were sent to.
      at: mine.length ? mine[mine.length - 1].roomId : a.at,
      ahead: busy.length,
      freeMs: Math.max(now, ...busy.map((b) => b.endMs)),
      forecastFreeMs: Math.max(now, ...busy.map((b) => b.forecastEndMs)),
    };
  });
  const minutes = (ms: number) => ms / hm(1);
  /** Minutes until an attendant can be at a room's door: finish what they have, then walk there. */
  const reach = (a: (typeof team)[number], room: Room) => minutes(a.forecastFreeMs - now) + walkMin(a.at, room.id);

  let best: { room: Room; a: (typeof team)[number]; score: number } | null = null;
  for (const room of pool) {
    // The room goes to the closest attendant…
    const a = team.reduce((x, y) => (reach(y, room) < reach(x, room) ? y : x));
    // …and the guest gets the room that will be ready soonest that way, in the size their party needs.
    const size = guest.party <= 2 ? { King: 0, 'Double Queen': 2, Suite: 4 }[room.type] : room.type === 'Suite' && guest.party < 4 ? 2 : 0;
    const score = reach(a, room) + HIST_AVG[room.type] + INSPECTION_MIN + size;
    if (!best || score < best.score - 1e-9) best = { room, a, score };
  }
  const { room, a } = best!;
  const travel = walkMin(a.at, room.id);
  const position = a.ahead + 1;
  const h = hash(guest.code);
  // How messy the room really is: 92–108% of the average clean time.
  const condition = 0.92 + (h % 17) / 100;
  const queueMin = Math.round(minutes(a.freeMs - now) + travel);
  const forecastQueue = Math.round(minutes(a.forecastFreeMs - now) + travel);
  const free = pool.length;

  const reasons = [
    `Room ${room.id} · ${room.type}${guest.party > 2 ? `, room for ${guest.party}` : ''}${room.block ? ', on the wedding floors' : blockFull ? ' — the wedding floors are full' : ''}`,
    `${a.name} is the closest attendant — ${distanceWords(a.at, room.id)}${a.ahead === 0 ? ', free now' : `, after ${roomWord(a.ahead)} they’re finishing`}`,
    `Starts on it in about ${forecastQueue} min`,
    `${room.type} rooms take about ${HIST_AVG[room.type]} minutes to clean`,
    `A ${INSPECTION_MIN}-minute final check`,
    `Compared ${roomWord(free)} and ${TEAM.length} attendants — this was the earliest ready time`,
  ];

  return {
    roomId: room.id,
    floor: room.floor,
    type: room.type,
    queueMin,
    cleanMin: Math.round(HIST_AVG[room.type] * condition),
    predictedMin: forecastQueue + HIST_AVG[room.type] + INSPECTION_MIN,
    bandMin: Math.round(6 + 4 * Math.sqrt(position)),
    position,
    attendantId: a.id,
    attendant: a.name,
    reasons,
  };
}
