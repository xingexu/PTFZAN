import type { Confidence, Hvac, Room, RoomStatus, SimState } from '../../../shared/types';

export const STATUS_LABEL: Record<RoomStatus, string> = {
  occupied: 'Guest still in',
  stayover: 'Guest staying on',
  dirty: 'Empty, needs cleaning',
  cleaning: 'Being cleaned',
  inspection: 'Final check',
  ready: 'Ready',
  ooo: 'Being repaired',
};

/** Short labels that fit inside a room tile. */
export const TILE_LABEL: Record<RoomStatus, string> = {
  occupied: 'Guest in',
  stayover: 'Staying',
  dirty: 'To clean',
  cleaning: 'Cleaning',
  inspection: 'Checking',
  ready: 'Ready',
  ooo: 'Repair',
};

// Same colours on every screen (see the room tiles in styles.css).
export const STATUS_COLOR: Record<RoomStatus, string> = {
  occupied: '#5d6a67',
  stayover: '#3f4846',
  dirty: '#f5c451',
  cleaning: '#6aa9ff',
  inspection: '#b5e34f',
  ready: '#3ddc97',
  ooo: '#ff7b6b',
};

export const HVAC_LABEL: Record<Hvac, string> = {
  comfort: 'Guest in · comfortable',
  running: 'Empty · heat/AC on full',
  eco: 'Empty · energy saver',
  precool: 'Getting ready for the guest',
};
export const HVAC_TILE: Record<Hvac, string> = { comfort: 'Comfort', running: 'Full on', eco: 'Saver', precool: 'Prepping' };
export const HVAC_COLOR: Record<Hvac, string> = { comfort: '#5d6a67', running: '#ff7b6b', eco: '#7fdccb', precool: '#6aa9ff' };

export const CONF_COLOR: Record<Confidence, string> = { high: '#3ddc97', medium: '#f5c451', low: '#ff7b6b' };
export const CONF_WIDTH: Record<Confidence, string> = { high: '100%', medium: '62%', low: '30%' };

/** What the front desk can see for this room. Today's process only knows the last phoned-in status. */
export function visibleStatus(s: SimState, r: Room): RoomStatus {
  return s.mode === 'ai' ? r.status : s.frontDeskSnapshot[r.id] ?? r.status;
}

/** True if the room has an arriving guest whose predicted ready time is after they arrive. */
export function atRisk(s: SimState, r: Room): boolean {
  if (s.mode !== 'ai' || !r.eta || r.status === 'ready') return false;
  const g = s.guests.find((x) => x.roomId === r.id && !x.isDemoGuest && !x.inHouse && x.state !== 'checked-in');
  if (!g) return false;
  const due = g.group && s.groupConfirmed ? 15 * 60 : Math.min(g.expectedArrival, 15 * 60);
  return r.eta.high > due && s.now > due - 120;
}

/** Metrics for each side of the comparison, whichever mode is on screen. */
export function sides(s: SimState) {
  const other = s.compare?.metrics ?? null;
  return s.mode === 'ai' ? { ai: s.metrics, today: other } : { ai: other, today: s.metrics };
}
