// The 30-second demo: one button replays the whole Oct 16 shift with FHN AI.
// It races through the quiet morning, holds briefly while the supervisor approves the wedding re-plan,
// and slows down for the arrivals rush, where the lobby comparison matters most.
import { SIM_END, SIM_START, TIME as t } from './seed.js';

/** How long the approval card stays on screen before the supervisor "taps" Approve. */
export const DEMO_HOLD_MS = 2000;

const PROFILE: { until: number; speed: number }[] = [
  { until: t(14, 30), speed: 30 }, // sick call, late checkouts, elevator, wedding change
  { until: t(16, 0), speed: 9 }, // arrivals rush — guests get "room ready" texts
  { until: SIM_END + 1, speed: 30 }, // wrap-up to the 5 PM summary
];

/** Simulation minutes per real second at a given simulation minute. */
export const demoSpeedAt = (now: number): number => (PROFILE.find((p) => now < p.until) ?? PROFILE[PROFILE.length - 1]).speed;

/** Total real-time length of the demo in seconds (one tick per simulated minute, plus the approval hold). */
export function demoDurationSec(): number {
  let sec = DEMO_HOLD_MS / 1000;
  for (let m = SIM_START; m <= SIM_END; m++) sec += 1 / demoSpeedAt(m);
  return sec;
}
