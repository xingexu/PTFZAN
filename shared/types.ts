// Shared domain types used by both the API server and the React client.
// Times are "simulation minutes since midnight" (e.g. 15:00 → 900).

export type Mode = 'baseline' | 'readypath';

export type RoomType = 'King' | 'Double Queen' | 'Suite';

export type RoomStatus =
  | 'occupied' // departing guest still in room
  | 'stayover' // in-house guest staying another night (needs light service)
  | 'dirty' // vacant, needs a full clean
  | 'cleaning'
  | 'inspection'
  | 'ready' // vacant, clean, inspected
  | 'ooo'; // out of order (maintenance)

export type Confidence = 'high' | 'medium' | 'low';

export interface Eta {
  low: number;
  high: number;
  confidence: Confidence;
  /** Short human-readable drivers of this estimate, shown in the "why" panel. */
  drivers: string[];
}

export interface Room {
  id: string; // "512"
  floor: number;
  type: RoomType;
  status: RoomStatus;
  /** Scheduled departure for the outgoing guest (occupied rooms). */
  scheduledCheckout?: number;
  /** Actual departure time (hidden from the planner until reported). */
  actualCheckout?: number;
  /** True once a late checkout has been reported in the PMS. */
  lateReported?: boolean;
  /** Stayover rooms become serviceable when the guest leaves for the day. */
  guestOutAt?: number;
  /** Next arriving reservation for this room, if any. */
  arrivalId?: string;
  groupBlock?: string;
  /** Attendant currently cleaning (only room-level; no speed data is kept per person). */
  cleaningBy?: string;
  workStartedAt?: number;
  workEndsAt?: number; // hidden ground truth
  readyAt?: number;
  eta?: Eta;
  /** First ETA upper bound promised to a guest — used to score forecast accuracy. */
  promisedBy?: number;
  maintenanceTicket?: string;
  /** What kind of service is in progress (set while cleaning). */
  serviceKind?: 'full' | 'stayover';
  /** Stayover rooms: true once today's service is done. */
  serviced?: boolean;
  /** Baseline: last time an attendant knocked on this (still occupied) room. */
  knockedAt?: number;
}

export interface Attendant {
  id: string;
  label: string; // "Attendant 1" — deliberately anonymous
  present: boolean;
  queue: string[]; // room ids, in order
  busyUntil: number; // sim minute when current task (cleaning, travel, wasted knock) ends
  currentRoom?: string;
  lastFloor: number;
  activity: string;
  breakAt: number;
  hadBreak: boolean;
  wastedVisits: number;
}

export type GuestState =
  | 'expected'
  | 'informed-away' // got a realistic ETA and chose not to queue
  | 'waiting' // standing in the lobby
  | 'checked-in';

export interface Guest {
  code: string; // portal code, e.g. "WED512A"
  name: string;
  partySize: number;
  roomId: string;
  group?: string;
  arrivalTime: number; // when they physically arrive
  expectedArrival: number; // what the hotel believes before 13:15
  state: GuestState;
  arrivedAt?: number;
  checkedInAt?: number;
  consentSms: boolean;
  phoneMasked: string;
  notifyBrowser: boolean;
  lastEtaSent?: { low: number; high: number };
  isDemoGuest?: boolean;
  /** Minutes spent standing in the lobby without a room. */
  lobbyMinutes: number;
  /** Informed-away guests come back at this time after the "ready" message. */
  returnAt?: number;
  /** Front desk is busy re-rooming this guest until this time (baseline). */
  heldUntil?: number;
}

export type NotificationKind = 'eta' | 'eta-update' | 'ready' | 'room-change' | 'info';

export interface GuestNotification {
  id: string;
  guestCode: string;
  at: number;
  kind: NotificationKind;
  channel: 'sms' | 'push';
  title: string;
  body: string;
}

export interface MaintenanceTicket {
  id: string;
  roomId?: string;
  asset: string;
  issue: string;
  openedAt: number;
  status: 'open' | 'resolved';
  owner: string;
  impact: string;
}

export interface PlanChange {
  roomId: string;
  from: string; // e.g. "Attendant 2 · #7"
  to: string;
  reason: string;
}

export interface PlanProposal {
  id: string;
  createdAt: number;
  trigger: string;
  summary: string;
  changes: PlanChange[];
  /** Proposed attendant queues to apply on approval. */
  queues: Record<string, string[]>;
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'auto-applied' | 'dismissed';
  impact: string;
}

export interface LogEntry {
  at: number;
  dept: 'Housekeeping' | 'Front desk' | 'Maintenance' | 'Duty manager' | 'ReadyPath' | 'Guest';
  text: string;
  tone: 'neutral' | 'warn' | 'bad' | 'good' | 'ai';
}

export interface ScenarioEvent {
  at: number;
  id: string;
  title: string;
  detail: string;
}

export interface Metrics {
  lobbyWaiting: number;
  lobbyPeak: number;
  informedAway: number;
  checkedIn: number;
  groupRoomsReadyBy1500: number;
  groupRoomsTotal: number;
  groupRoomsNotReady: number;
  avgWaitMin: number;
  longestWaitMin: number;
  readinessCalls: number;
  notificationsSent: number;
  etaAccuracyPct: number | null; // % of rooms ready by the time promised to the guest
  etaScored: number;
  wastedVisits: number;
}

export interface DeskAgent {
  id: string;
  busyUntil: number;
  task: string;
}

export interface SimState {
  mode: Mode;
  now: number;
  start: number;
  end: number;
  playing: boolean;
  speed: number; // sim minutes per real second
  autoApprove: boolean;
  elevatorDown: boolean;
  groupConfirmed: boolean;
  rooms: Room[];
  attendants: Attendant[];
  guests: Guest[];
  notifications: GuestNotification[];
  tickets: MaintenanceTicket[];
  proposals: PlanProposal[];
  log: LogEntry[];
  events: ScenarioEvent[];
  nextEventIndex: number;
  metrics: Metrics;
  /** Baseline front desk only sees what the last phone call told them. */
  frontDeskSnapshotAt: number;
  frontDeskSnapshot: Record<string, RoomStatus>;
  deskAgents: DeskAgent[];
  pausedReason?: string;
  finished: boolean;
}

export const fmtTime = (minutes: number): string => {
  const t = Math.round(minutes);
  const h = Math.floor(t / 60);
  const mm = t % 60;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** Range like "3:20–3:40 PM" (drops the duplicate meridiem). */
export const fmtRange = (low: number, high: number): string => {
  const a = fmtTime(low);
  const b = fmtTime(high);
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}–${b}`;
  return `${a}–${b}`;
};

export const fmt24 = (minutes: number): string => {
  const t = Math.round(minutes);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
