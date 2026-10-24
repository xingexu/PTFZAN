// Where things are in the hotel, so "the closest attendant" means something. Each floor is one corridor of 12
// rooms (01 at one end, 12 at the other) with the elevators in the middle, between 06 and 07. Walking time is
// counted door to door; changing floors means walking to the elevator, riding, and walking from it.

/** Minutes to pass one door with a cart. */
const DOOR_MIN = 0.12;
/** Minutes to get going on the same floor (park the cart, knock, open up). */
const SAME_FLOOR_MIN = 0.6;
/** Minutes waiting for and riding the elevator, plus a little per floor. */
const RIDE_MIN = 2.5;
const PER_FLOOR_MIN = 0.4;
const ELEVATOR_AT = 6.5;

/** A place in the hotel: a room ("504"), or a floor's elevator lobby (just the floor number). */
export type Spot = string | number;

const where = (s: Spot) =>
  typeof s === 'number' ? { floor: s, door: ELEVATOR_AT } : { floor: Number(s[0]), door: Number(s.slice(1)) };

/**
 * Walking minutes from one spot to a room. (The Elevator B outage is charged per room on floors 5–6 by the
 * scenario itself — carts share Elevator A — so it isn't added again here.)
 */
export function walkMin(from: Spot, to: string): number {
  const a = where(from);
  const b = where(to);
  if (a.floor === b.floor) return SAME_FLOOR_MIN + DOOR_MIN * Math.abs(a.door - b.door);
  const ride = RIDE_MIN + PER_FLOOR_MIN * Math.abs(a.floor - b.floor);
  return DOOR_MIN * Math.abs(a.door - ELEVATOR_AT) + ride + DOOR_MIN * Math.abs(ELEVATOR_AT - b.door);
}

/** How far, in words: "next door", "3 doors away on floor 5", "on floor 3 (an elevator ride away)". */
export function distanceWords(from: Spot, to: string): string {
  const a = where(from);
  const b = where(to);
  if (a.floor !== b.floor) return `on floor ${a.floor} — an elevator ride away`;
  const doors = Math.round(Math.abs(a.door - b.door));
  if (typeof from === 'number') return `already on floor ${b.floor}`;
  if (doors === 0) return `already at ${to}`;
  return doors === 1 ? `next door on floor ${b.floor}` : `${doors} doors away on floor ${b.floor}`;
}
