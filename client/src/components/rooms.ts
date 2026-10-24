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

export const STATUS_COLOR: Record<RoomStatus, string> = {
  occupied: '#98A2B3',
  stayover: '#D0D5DD',
  dirty: '#DC8A00',
  cleaning: '#2E90FA',
  inspection: '#66A80F',
  ready: '#12A150',
  ooo: '#E5483D',
};

export const HVAC_LABEL: Record<Hvac, string> = {
  comfort: 'Guest in · comfortable',
  running: 'Empty · heat/AC on full',
  eco: 'Empty · energy saver',
  precool: 'Getting ready for the guest',
};
export const HVAC_TILE: Record<Hvac, string> = { comfort: 'Comfort', running: 'Full on', eco: 'Saver', precool: 'Prepping' };
export const HVAC_COLOR: Record<Hvac, string> = { comfort: '#98A2B3', running: '#E5483D', eco: '#0E9384', precool: '#2E90FA' };

export const CONF_COLOR: Record<Confidence, string> = { high: '#12A150', medium: '#DC8A00', low: '#E5483D' };
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
