import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { CompareSnapshot, Metrics, RoomStatus, ScenarioEvent, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim } from '../api';
import { CompareBars, Num } from '../components/Compare';
import { Icon, type IconName } from '../components/Icon';
import { sides } from '../components/rooms';
import { useActivity, type ActivityItem } from '../hotel/activity';
import { GUEST_TAB, guestQrUrl, guestUrl } from '../links';

type M = Metrics | null;
type BoardRoom = CompareSnapshot['rooms'][number];
const SEATS = 40;
const FLOORS = [6, 5, 4, 3];
const LEGEND: [string, string][] = [
  ['ready', 'Ready'],
  ['cleaning', 'Cleaning'],
  ['inspection', 'Final check'],
  ['dirty', 'Needs cleaning'],
  ['occupied', 'Guest inside'],
];
const STATUS_WORD: Record<RoomStatus, string> = {
  ready: 'ready', cleaning: 'being cleaned', inspection: 'final check', dirty: 'needs cleaning', occupied: 'guest inside', stayover: 'guest staying', ooo: 'being repaired',
};

export default function Comparison() {
  const { state } = useSim();
  if (!state) return null;
  const { ai, today } = sides(state);
  const other = state.compare?.rooms ?? [];
  const aiRooms = state.mode === 'ai' ? state.rooms : other;
  const todayRooms = state.mode === 'ai' ? other : state.rooms;
  const acBroken = state.now >= 14 * 60 + 5;
  const wasted = (m: M) => (m ? m.attendantMinLost + m.pulledStaffMin : 0);

  return (
    <main className="page live">
      <header className="sim-head">
        <div><span className="page-eyebrow">TORONTO DOWNTOWN</span><h1>Compare the day</h1><p className="page-subtitle">Room readiness and guest arrivals for Friday, October 16.</p></div>
        <span className="sim-chip"><Icon name={state.finished ? 'check' : 'clock'} size={13} />{state.finished ? 'Shift complete' : 'Friday, October 16 · Live simulation'}</span>
      </header>
      <section className="live-summary" aria-label="Shift at a glance">
        <div className="summary-metric glass"><span className="summary-metric-icon"><Icon name="bed" size={20} /></span><div><span>Rooms ready</span><b><Num value={aiRooms.filter((r) => r.status === 'ready').length} /><small> / 48</small></b></div><span className="summary-metric-note">FHN AI</span></div>
        <div className="summary-metric glass"><span className="summary-metric-icon"><Icon name="users" size={20} /></span><div><span>Guests waiting</span><b><Num value={ai?.lobbyWaiting ?? 0} /><small> in the lobby</small></b></div><span className="summary-metric-note">FHN AI</span></div>
        <div className="summary-metric glass"><span className="summary-metric-icon"><Icon name="leaf" size={20} /></span><div><span>Energy saved</span><b><Num value={ai?.kwhSaved ?? 0} /><small> kWh</small></b></div><span className="summary-metric-note">Today</span></div>
      </section>
      <section className="versus" aria-label="Every room, side by side">
        <Board kind="today" rooms={todayRooms} m={today} />
        <Board kind="ai" rooms={aiRooms} m={ai} />
        <div className="legend" aria-hidden="true">
          {LEGEND.map(([k, label]) => (
            <span key={k}>
              <i className={`s-${k}`} /> {label}
            </span>
          ))}
          <span>
            <i className="wed-key" /> Wedding party room
          </span>
        </div>
      </section>

      <section className="wins" aria-label="The four challenges">
        <Challenge icon="users" label="Most guests waiting" today={today?.lobbyPeak} ai={ai?.lobbyPeak} />
        <Challenge icon="clock" label="Staff time wasted" unit="min" today={wasted(today)} ai={wasted(ai)} />
        <Challenge icon="wrench" label="Broken AC fixed in" unit="min" today={today?.acFixMin} ai={ai?.acFixMin} open="still broken" waiting={acBroken ? undefined : 'Room 411’s AC breaks at 2:05 PM'} />
        <Challenge icon="leaf" label="Energy saved" unit="kWh" today={today?.kwhSaved} ai={ai?.kwhSaved} more />
      </section>

      <aside className="live-side">
        <GuestCard />
        <HotelLog state={state} />
      </aside>
    </main>
  );
}

/** One side of the comparison: the hotel drawn as a 2D cross-section — four guest floors over the lobby. */
function Board({ kind, rooms, m }: { kind: 'today' | 'ai'; rooms: BoardRoom[]; m: M }) {
  const wedding = rooms.filter((r) => r.groupBlock);
  const total = wedding.length || 20;
  const ready = wedding.filter((r) => r.status === 'ready').length;
  const waiting = m?.groupWaiting ?? 0;

  return (
    <div className={`board glass ${kind}`}>
      <header className="bd-head">
        <div className="bd-title">
          <span className="board-eyebrow">{kind === 'ai' ? 'AI-ASSISTED PLAN' : 'MANUAL PLAN'}</span>
          <h2>{kind === 'ai' ? 'With FHN AI' : 'Previous method'}</h2>
          <p>{kind === 'ai' ? 'Live room status and updated assignments.' : 'Paper lists and phone updates.'}</p>
        </div>
        <div className="bd-stat" aria-label={`${ready} of ${total} wedding rooms ready`}>
          <span className="bd-stat-label">Wedding rooms ready</span>
          <span className="bd-stat-num">
            <b>
              <Num value={ready} />
            </b>
            <span>/ {total}</span>
          </span>
        </div>
      </header>
      <div className="bd-progress" aria-hidden="true">
        <i style={{ width: `${(ready / total) * 100}%` }} />
      </div>

      <div className="building" role="img" aria-label={`Cross-section of the hotel: ${ready} of ${total} wedding rooms ready, ${waiting} guests waiting in the lobby`}>
        <div className="roof" aria-hidden="true" />
        {FLOORS.map((f) => (
          <div className="storey" key={f}>
            <span className="fl-n">{f}</span>
            {rooms
              .filter((r) => r.id.startsWith(String(f)))
              .map((r) => (
                <span key={r.id} title={`Room ${r.id} · ${STATUS_WORD[r.status]}`} className={`rm s-${r.status === 'stayover' ? 'occupied' : r.status} ${r.groupBlock ? 'wed' : ''}`}>
                  <span className="rm-f">{f}</span>
                  {r.id.slice(1)}
                </span>
              ))}
          </div>
        ))}
        <div className="storey lobby">
          <span className="fl-n">L</span>
          <div className="lobby-floor">
            <span className="lb-label">Lobby</span>
            <People waiting={waiting} />
            <span className={`lb-num ${waiting ? 'hot' : ''}`}>
              <b>
                <Num value={waiting} />
              </b>{' '}
              waiting
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const PERSON = 'M5.5 3.2a2.2 2.2 0 1 1 0 .01ZM2 13v-3.2C2 7.9 3.6 6.6 5.5 6.6S9 7.9 9 9.8V13z';

/** The 40 wedding guests; the ones waiting in the lobby are shown in colour. */
function People({ waiting }: { waiting: number }) {
  return (
    <span className="people" aria-hidden="true">
      {Array.from({ length: SEATS }, (_, i) => (
        <svg key={i} viewBox="0 0 11 13" className={i < waiting ? 'on' : ''}>
          <path d={PERSON} />
        </svg>
      ))}
    </span>
  );
}

/** One challenge: today's way and FHN AI side by side. */
function Challenge({
  icon, label, unit, today, ai, more, open, waiting,
}: { icon: IconName; label: string; unit?: string; today?: number | null; ai?: number | null; more?: boolean; open?: string; waiting?: string }) {
  // FHN AI is ahead once its number is in and today's is worse or still open.
  const better = ai != null && (today == null ? !more : more ? ai > today : ai < today);
  return (
    <div className="win glass">
      <div className="win-top">
        <span className="win-ic">
          <Icon name={icon} size={15} />
        </span>
        <span className="win-label">{label}</span>
        {better && !waiting && <Icon name="check" size={14} className="win-ok" />}
      </div>
      {waiting ? <span className="win-wait">{waiting}</span> : <CompareBars today={today} ai={ai} unit={unit} open={open} />}
    </div>
  );
}

/** The QR code that opens the guest app, with how many people are using it right now. */
function GuestCard() {
  const { counts, online } = useActivity();
  const url = guestQrUrl();
  const [src, setSrc] = useState('');
  useEffect(() => {
    // Dark modules on a clear background, so the code sits on the glass instead of a white box.
    QRCode.toDataURL(url, { margin: 2, width: 260, color: { dark: '#1d1d1f', light: '#00000000' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  let count = online ? 'Live' : 'Connecting…';
  if (counts) count = counts.registered ? `${counts.registered} registered · ${counts.checkedIn} checked in` : 'Live · be the first to register';
  return (
    <a className="guest-card glass" href={guestUrl('/')} target={GUEST_TAB} title={url}>
      {src ? <img src={src} alt={`QR code to ${url}`} className="fade-img" /> : <span className="qr-blank" />}
      <span className="gc-text">
        <b>Be a wedding guest</b>
        <span className="gc-sub">Scan to try the guest app</span>
        <span className={`gc-count ${online ? 'on' : ''}`}>
          <i />
          {count}
        </span>
      </span>
    </a>
  );
}

const MOMENT_ICON: Record<string, IconName> = {
  absence: 'users', late: 'clock', elevator: 'alert', group: 'calendar', calls: 'phone', arrivals: 'bag', checkpoint: 'users', release: 'check',
};
const GUEST_ICON: Record<string, IconName> = {
  register: 'user', 'check-in': 'key', unlock: 'door', issue: 'wrench', request: 'box', green: 'leaf',
};

interface Entry {
  key: string;
  icon: IconName;
  tone: string;
  title: string;
  line?: string;
  when: string;
  order: number;
}

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(at);
  return fmtTime(d.getHours() * 60 + d.getMinutes());
};

/**
 * The hotel log, in plain words: the day's big moments as the replay passes them, and what real guests
 * are doing in the guest app right now. Newest first.
 */
function HotelLog({ state }: { state: SimState }) {
  const { items } = useActivity();
  // When each of the day's moments appeared, so they interleave with guest activity in the order they happened.
  const seenAt = useRef(new Map<string, number>());
  const passed = state.events.slice(0, state.nextEventIndex);
  const ids = new Set(passed.map((e) => e.id));
  for (const id of seenAt.current.keys()) if (!ids.has(id)) seenAt.current.delete(id);
  passed.forEach((e, i) => {
    if (!seenAt.current.has(e.id)) seenAt.current.set(e.id, Date.now() + i);
  });
  const ai = state.mode === 'ai';
  const moment = (e: ScenarioEvent): Entry => ({
    key: e.id,
    icon: MOMENT_ICON[e.id] ?? 'info',
    tone: ai ? 'ai' : 'today',
    title: e.title,
    line: ai ? e.ai : e.today,
    when: fmtTime(e.at),
    order: seenAt.current.get(e.id)!,
  });
  const guest = (a: ActivityItem): Entry => ({ key: `g${a.id}`, icon: GUEST_ICON[a.kind] ?? 'phoneDevice', tone: 'guest', title: a.text, line: 'Guest app', when: ago(a.at), order: a.at });
  const entries = [...passed.map(moment), ...items.map(guest)].sort((a, b) => b.order - a.order).slice(0, 12);

  return (
    <section className="hotel-log glass" aria-label="Hotel log">
      <h2>Hotel log</h2>
      {entries.length === 0 ? (
        <p className="hl-empty">
          <Icon name="play" size={14} /> Press <b>30-sec demo</b> to play Friday, October 16.
        </p>
      ) : (
        <ul aria-live="polite">
          {entries.map((e, i) => (
            <li key={e.key} className={`hl ${e.tone} ${i === 0 ? 'latest' : ''}`}>
              <span className="hl-ic">
                <Icon name={e.icon} size={14} />
              </span>
              <span className="hl-text">
                <b>{e.title}</b>
                {e.line && <span>{e.line}</span>}
              </span>
              <span className="hl-when">{e.when}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
