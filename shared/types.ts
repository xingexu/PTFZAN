// Shared domain types used by both the API server and the React client.
// Times are "simulation minutes since midnight" (e.g. 15:00 → 900).

/** baseline = today's process · ai = FHN AI coordinating every department. */
export type Mode = 'baseline' | 'ai';

export type RoomType = 'King' | 'Double Queen' | 'Suite';

export type RoomStatus =
  | 'occupied' // departing guest still in room
  | 'stayover' // in-house guest staying another night (needs light service)
  | 'dirty' // vacant, needs a full clean
  | 'cleaning'
  | 'inspection'
  | 'ready' // vacant, clean, inspected
  | 'ooo'; // out of order (maintenance)

/**
 * Room climate state.
 * comfort = someone is in the room · running = vacant but still at full HVAC (today's waste)
 * eco = vacant, set back · precool = returning to comfort ahead of a predicted arrival
 */
export type Hvac = 'comfort' | 'running' | 'eco' | 'precool';

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
  hvac: Hvac;
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
  /** Minutes lost knocking on rooms that were still occupied. */
  wastedMin: number;
  /** Pulled off another job at escalation (today's process only). */
  helper?: boolean;
  /** On the on-call list: works only if someone books them. */
  onCall?: boolean;
}

export type GuestState =
  | 'expected'
  | 'informed-away' // got a realistic ETA and chose not to queue
  | 'waiting' // standing in the lobby
  | 'checked-in';

export type HousekeepingPref = 'standard' | 'green' | 'dnd';

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
  /** Already staying with us (not an arrival) — excluded from arrival metrics. */
  inHouse?: boolean;
  /** Demo guests: completed online check-in in the guest app. */
  onlineCheckIn?: boolean;
  /** Minutes spent standing in the lobby without a room. */
  lobbyMinutes: number;
  /** Informed-away guests come back at this time after the "ready" message. */
  returnAt?: number;
  /** Front desk is busy re-rooming this guest until this time (baseline). */
  heldUntil?: number;
  housekeeping: HousekeepingPref;
  /** Preferred room temperature, °C. */
  setpoint: number;
  /** Checked-in guest stepped out; expected back around this time (drives eco / pre-conditioning). */
  awayUntil?: number;
}

export type NotificationKind = 'eta' | 'eta-update' | 'ready' | 'room-change' | 'info' | 'request';

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
  resolvedAt?: number;
}

/** A guest's request or problem report, tracked from report to resolution. */
export interface GuestRequest {
  id: string;
  guestCode: string;
  roomId: string;
  kind: 'issue' | 'amenity';
  title: string;
  openedAt: number;
  /** Who owns it — shown to the guest so they never have to report twice. */
  owner: string | null;
  /** Promised by (null = no promise given, i.e. today's process). */
  etaAt: number | null;
  status: 'received' | 'assigned' | 'on-the-way' | 'resolved';
  resolvedAt?: number;
  ticketId?: string;
  /** How many times the guest had to report it. */
  reports: number;
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
  dept: 'Housekeeping' | 'Front desk' | 'Maintenance' | 'Duty manager' | 'FHN AI' | 'Guest';
  text: string;
  tone: 'neutral' | 'warn' | 'bad' | 'good' | 'ai';
  /** Something a guest did in the guest app — the hotel view surfaces these as they happen. */
  fromApp?: boolean;
}

export interface ScenarioEvent {
  at: number;
  id: string;
  title: string;
  detail: string;
  /** One-line caption for each way of running the day. */
  today: string;
  ai: string;
}

export interface Metrics {
  // Room readiness & arrivals
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
  /** Wedding party, in persons. */
  groupWaiting: number;
  groupAway: number;
  groupIn: number;
  groupExpected: number;
  // Labour
  wastedVisits: number;
  attendantMinLost: number;
  /** Staff-minutes pulled off other jobs (supervisor, houseperson) to finish rooms after escalation. */
  pulledStaffMin: number;
  // Maintenance
  ticketsOpen: number;
  /** Extra times a guest had to report the same problem. */
  repeatReports: number;
  /** Minutes from the 411 AC report to the fix (null = not fixed yet). */
  acFixMin: number | null;
  // Energy
  ecoRoomHours: number;
  kwhSaved: number;
  /** Vacant rooms still at full heating/cooling right now. */
  vacantRunning: number;
  /** Arrivals whose room was brought back to comfort before they walked in. */
  preconditioned: number;
}

export interface DeskAgent {
  id: string;
  busyUntil: number;
  task: string;
}

/** Tomorrow's housekeeping workload, forecast from reservations and room-type clean times (never per person). */
export interface StaffingForecast {
  date: string;
  departures: number;
  stayovers: number;
  greenChoice: number;
  arrivals: number;
  workloadHours: number;
  scheduled: number;
  attendantsNeeded: number;
  /** Overtime hours if the current schedule is kept. */
  overtimeHours: number;
  recommendation: string;
  blocks: { label: string; attendants: number; load: number }[];
}

/** A recurring fault found by normalising free-text maintenance spreadsheet rows. */
export interface MaintenanceInsight {
  asset: string;
  location: string;
  fault: string;
  occurrences: number;
  windowDays: number;
  severity: 'high' | 'medium';
  recommendation: string;
  examples: { date: string; raw: string }[];
}

/** The same day, replayed in the other mode — lets every screen show "today vs with FHN AI". */
export interface CompareSnapshot {
  mode: Mode;
  now: number;
  metrics: Metrics;
  /** Room by room, so both sides can light rooms up as they become ready. */
  rooms: { id: string; status: RoomStatus; groupBlock?: string }[];
}

export interface SimState {
  mode: Mode;
  now: number;
  start: number;
  end: number;
  playing: boolean;
  speed: number; // sim minutes per real second
  autoApprove: boolean;
  /** The 30-second demo is driving playback (speed profile + supervisor approval). */
  autopilot: boolean;
  elevatorDown: boolean;
  groupConfirmed: boolean;
  rooms: Room[];
  attendants: Attendant[];
  guests: Guest[];
  notifications: GuestNotification[];
  tickets: MaintenanceTicket[];
  requests: GuestRequest[];
  proposals: PlanProposal[];
  log: LogEntry[];
  events: ScenarioEvent[];
  nextEventIndex: number;
  metrics: Metrics;
  staffing: StaffingForecast;
  insights: MaintenanceInsight[];
  /** Baseline front desk only sees what the last phone call told them. */
  frontDeskSnapshotAt: number;
  frontDeskSnapshot: Record<string, RoomStatus>;
  deskAgents: DeskAgent[];
  pausedReason?: string;
  finished: boolean;
  /** Attached by the server: the shadow run in the other mode. */
  compare?: CompareSnapshot;
  /** Attached by the server: guest app sessions open right now. */
  guestsOnline?: number;
}

// ───────────────────────── Real guest messaging (SMS / push) ─────────────────────────

/**
 * twilio    = real SMS from a Twilio number
 * httpsms   = real SMS sent by your own Android phone (from your own number) via the httpSMS app
 * mac       = real iMessage/SMS sent by the Messages app on the Mac running the server (your Apple ID / number)
 * ntfy      = real push notification to the ntfy app on one phone (not SMS)
 * simulated = nothing leaves the server
 */
export type MessagingProvider = 'twilio' | 'httpsms' | 'mac' | 'ntfy' | 'simulated';

export type DeliveryStatus = 'simulated' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed';

export interface DeliveryRecord {
  id: string;
  guestCode: string;
  notificationId?: string;
  kind: NotificationKind | 'test';
  provider: MessagingProvider;
  /** Masked destination, e.g. "+1 (416) •••-0123" — full numbers never leave the server. */
  toMasked: string;
  /** Masked sender when it's the presenter's own number / Messages app. */
  from?: string;
  status: DeliveryStatus;
  error?: string;
  body: string;
  createdAt: number; // epoch ms
  updatedAt: number;
  /** Time from request to first "sent"/"delivered" confirmation. */
  latencyMs?: number;
  history: { status: DeliveryStatus; at: number }[];
}

export interface MessagingStatus {
  provider: MessagingProvider;
  /** Audience guests may opt in to real texts on /join (off for personal numbers unless explicitly allowed). */
  smsEnabled: boolean;
  /** Messages come from the presenter's own phone number / Apple ID. */
  personalNumber: boolean;
  /** Human-readable sender, e.g. "+1 (647) •••-0199" or "ntfy topic" */
  sender: string | null;
  trialTemplate: string | null;
  note: string;
}

// ───────────────────────── Stage mode ("Mike") ─────────────────────────

export type StageStep = 'booked' | 'checked-in' | 'ready';

export interface StageState {
  guestCode: string;
  name: string;
  roomId: string;
  roomType: RoomType;
  floor: number;
  step: StageStep;
  roomStatus: 'cleaning' | 'ready';
  eta: { low: number; high: number } | null;
  checkedInAt: number | null; // minutes of day (hotel time zone)
  readyAt: number | null;
  now: number; // minutes of day (hotel time zone)
  phoneMasked: string | null;
  sendReal: boolean;
  pinRequired: boolean;
  messages: GuestNotification[];
  deliveries: DeliveryRecord[];
  messaging: MessagingStatus;
  lastCueAt: number | null; // epoch ms
}

/** Privacy-scoped payload for one guest's app — never contains another guest's data. */
export interface GuestView {
  mode: Mode;
  now: number;
  hotel: string;
  stay: { arrive: string; depart: string; nights: number; confirmation: string };
  guest: {
    code: string;
    name: string;
    partySize: number;
    group?: string;
    state: GuestState;
    consentSms: boolean;
    notifyBrowser: boolean;
    phoneMasked: string;
    isDemoGuest: boolean;
    /** Completed online check-in (or is otherwise registered). */
    checkedInOnline: boolean;
    /** Can tap "Check in online" now. */
    canCheckIn: boolean;
    /** Physically in the room (mobile key used). */
    inRoom: boolean;
    housekeeping: HousekeepingPref;
  };
  room: { id: string | null; type: RoomType; status: RoomStatus; eta: Eta | null; readyAt: number | null; floor: number; attendant?: string };
  climate: { hvac: Hvac; setpoint: number; awayUntil: number | null };
  elevatorNotice: string | null;
  ticket: { id: string; owner: string; issue: string } | null;
  requests: GuestRequest[];
  notifications: GuestNotification[];
  /** Real-world delivery status of each notification (by notification id). */
  delivery: Record<string, { status: DeliveryStatus; provider: MessagingProvider; error?: string }>;
  /** The guest's room timeline in real time (epoch ms), for the countdown. */
  progress?: { startMs: number; cleanMs: number; checkMs: number; readyMs: number; highMs: number; secondsPerMinute: number };
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
