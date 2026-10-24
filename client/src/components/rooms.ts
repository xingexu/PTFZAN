import type { Confidence, Room, RoomStatus, SimState } from '../../../shared/types';

export const STATUS_LABEL: Record<RoomStatus, string> = {
  occupied: 'Guest in',
  stayover: 'Stayover',
  dirty: 'To clean (vacant)',
  cleaning: 'Cleaning',
  inspection: 'Inspection',
  ready: 'Ready',
  ooo: 'Out of order',
};

/** Short labels that fit inside a room tile. */
export const TILE_LABEL: Record<RoomStatus, string> = {
  occupied: 'Guest in',
  stayover: 'Stayover',
  dirty: 'To clean',
  cleaning: 'Cleaning',
  inspection: 'Inspect',
  ready: 'Ready',
  ooo: 'Repair',
};

export const STATUS_COLOR: Record<RoomStatus, string> = {
  occupied: '#9aa39f',
  stayover: '#c9cdc8',
  dirty: '#b9770e',
  cleaning: '#2a87a8',
  inspection: '#5b8f2c',
  ready: '#23845a',
  ooo: '#c0392b',
};

export const CONF_COLOR: Record<Confidence, string> = { high: '#23845a', medium: '#b9770e', low: '#c0392b' };
export const CONF_WIDTH: Record<Confidence, string> = { high: '100%', medium: '62%', low: '30%' };

/** What the front desk can see for this room. Baseline only knows the last phoned-in status. */
export function visibleStatus(s: SimState, r: Room): RoomStatus {
  return s.mode === 'readypath' ? r.status : s.frontDeskSnapshot[r.id] ?? r.status;
}

/** True if the room has an arriving guest whose predicted ready time is after they arrive. */
export function atRisk(s: SimState, r: Room): boolean {
  if (s.mode !== 'readypath' || !r.eta || r.status === 'ready') return false;
  const g = s.guests.find((x) => x.roomId === r.id && !x.isDemoGuest && x.state !== 'checked-in');
  if (!g) return false;
  const due = g.group && s.groupConfirmed ? 15 * 60 : Math.min(g.expectedArrival, 15 * 60);
  return r.eta.high > due && s.now > due - 120;
}
