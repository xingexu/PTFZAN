import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { CompareSnapshot, Metrics, RoomStatus, ScenarioEvent, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim } from '../api';
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

/** Eases a number toward its new value so changes read as motion, not jumps. */
function useTween(target: number, ms = 450) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = start + (target - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(value);
}

function Num({ value }: { value: number }) {
  return <>{useTween(value)}</>;
}

/** Counts each time a room turns ready while the day plays, so its tile can pop once. Rewinding clears it. */
function usePops(rooms: BoardRoom[], now: number) {
  const prev = useRef<Map<string, RoomStatus> | null>(null);
  const lastNow = useRef(now);
  const [pops, setPops] = useState<Record<string, number>>({});
  useEffect(() => {
    const before = prev.current;
    const rewound = now < lastNow.current;
    lastNow.current = now;
    prev.current = new Map(rooms.map((r) => [r.id, r.status]));
    if (!before || rewound) {
      setPops((x) => (Object.keys(x).length ? {} : x));
      return;
    }
    const fresh = rooms.filter((r) => r.status === 'ready' && before.get(r.id) !== undefined && before.get(r.id) !== 'ready');
    if (fresh.length)
      setPops((x) => {
        const y = { ...x };
        for (const r of fresh) y[r.id] = (y[r.id] ?? 0) + 1;
        return y;
      });
  }, [rooms, now]);
  return pops;
}

export default function Overview() {
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
      <section className="versus" aria-label="Every room, side by side">
        <Board kind="today" rooms={todayRooms} m={today} now={state.now} />
        <Board kind="ai" rooms={aiRooms} m={ai} now={state.now} />
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
        <Challenge icon="users" tone="red" label="Most guests stuck in the lobby" today={today?.lobbyPeak} ai={ai?.lobbyPeak} />
        <Challenge icon="clock" tone="violet" label="Staff time wasted" unit="min" today={wasted(today)} ai={wasted(ai)} />
        <Challenge icon="wrench" tone="amber" label="Broken AC fixed in" unit="min" today={today?.acFixMin} ai={ai?.acFixMin} open="still broken" waiting={acBroken ? undefined : 'Room 411’s AC breaks at 2:05 PM'} />
        <Challenge icon="leaf" tone="teal" label="Energy saved" unit="kWh" today={today?.kwhSaved} ai={ai?.kwhSaved} more />
      </section>

      <aside className="live-side">
        <GuestCard />
        <HotelLog state={state} />
      </aside>
    </main>
  );
}

/** One side of the comparison: all 48 rooms, floor by floor, and the wedding party in the lobby. */
function Board({ kind, rooms, m, now }: { kind: 'today' | 'ai'; rooms: BoardRoom[]; m: M; now: number }) {
  const pops = usePops(rooms, now);
  const wedding = rooms.filter((r) => r.groupBlock);
  const total = wedding.length || 20;
  const ready = wedding.filter((r) => r.status === 'ready').length;
  const waiting = m?.groupWaiting ?? 0;

  return (
    <div className={`board glass ${kind}`}>
      <header className="bd-head">
        <div className="bd-title">
          <h2>
            {kind === 'ai' && <Icon name="sparkles" size={16} />}
            {kind === 'ai' ? 'With FHN AI' : 'Today’s way'}
          </h2>
          <p>{kind === 'ai' ? 'One live plan for every room' : 'Paper lists and phone calls'}</p>
        </div>
        <Ring value={ready} total={total} kind={kind} />
      </header>

      <div className="floors" role="img" aria-label={`${ready} of ${total} wedding rooms ready`}>
        {FLOORS.map((f) => (
          <div className="floor" key={f}>
            <span className="fl-n">{f}</span>
            {rooms
              .filter((r) => r.id.startsWith(String(f)))
              .map((r) => (
                <span
                  key={r.id}
                  title={`Room ${r.id} · ${STATUS_WORD[r.status]}`}
                  className={`rm s-${r.status === 'stayover' ? 'occupied' : r.status} ${r.groupBlock ? 'wed' : ''} ${pops[r.id] ? 'popped' : ''}`}
                >
                  <span className="rm-in" key={pops[r.id] ?? 0} />
                </span>
              ))}
          </div>
        ))}
      </div>

      <footer className="lobby" aria-label={`${waiting} wedding guests waiting in the lobby`}>
        <span className="lb-label">Lobby</span>
        <People waiting={waiting} />
        <span className={`lb-num ${waiting ? 'hot' : ''}`}>
          <b>
            <Num value={waiting} />
          </b>{' '}
          waiting
        </span>
      </footer>
    </div>
  );
}

/** Wedding rooms ready, as an activity ring. */
function Ring({ value, total, kind }: { value: number; total: number; kind: 'today' | 'ai' }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring ${kind}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="ring-track" />
        <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - value / total)} />
      </svg>
      <span className="ring-num">
        <b>
          <Num value={value} />
        </b>
        <small>/{total}</small>
      </span>
      <span className="ring-label">wedding rooms ready</span>
    </div>
  );
}

const PERSON = 'M5.5 3.2a2.2 2.2 0 1 1 0 .01ZM2 13v-3.2C2 7.9 3.6 6.6 5.5 6.6S9 7.9 9 9.8V13z';

/** The 40 wedding guests; the ones waiting in the lobby light up. */
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

/** One challenge: today's way and FHN AI as two bars. A side with no number yet says so (`open`). */
function Challenge({
  icon, tone, label, unit = '', today, ai, more, open = '—', waiting,
}: { icon: IconName; tone: string; label: string; unit?: string; today?: number | null; ai?: number | null; more?: boolean; open?: string; waiting?: string }) {
  const max = Math.max(1, today ?? 0, ai ?? 0);
  const bar = (v: number | null | undefined, who: 'today' | 'ai') => (
    <div className={`cb ${who} ${v == null ? 'open' : ''}`}>
      <span className="cb-who">{who === 'ai' ? 'FHN AI' : 'Today'}</span>
      <span className="cb-track">
        <i style={{ width: `${v == null ? 100 : Math.max(2, (v / max) * 100)}%` }} />
      </span>
      <span className="cb-val">
        {v == null ? (
          <small>{open}</small>
        ) : (
          <>
            <Num value={v} />
            {unit && <small>{unit}</small>}
          </>
        )}
      </span>
    </div>
  );
  // FHN AI wins once its number is in and today's is worse or still open.
  const better = ai != null && (today == null ? !more : more ? ai > today : ai < today);
  return (
    <div className={`win glass tone-${tone}`}>
      <div className="win-top">
        <span className="win-ic">
          <Icon name={icon} size={15} />
        </span>
        <span className="win-label">{label}</span>
        {better && !waiting && <Icon name="check" size={14} className="win-ok" />}
      </div>
      {waiting ? (
        <span className="win-wait">{waiting}</span>
      ) : (
        <>
          {bar(today, 'today')}
          {bar(ai, 'ai')}
        </>
      )}
    </div>
  );
}

/** The QR code that opens the guest app, with how many people are using it right now. */
function GuestCard() {
  const { counts, online } = useActivity();
  const url = guestQrUrl();
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#151718', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return (
    <a className="guest-card glass" href={guestUrl('/')} target={GUEST_TAB} title={url}>
      {src ? <img src={src} alt={`QR code to ${url}`} /> : <span className="qr-blank" />}
      <span className="gc-text">
        <b>Be a wedding guest</b>
        <span className="gc-sub">Scan to try the guest app</span>
        <span className={`gc-count ${online ? 'on' : ''}`}>
          <i />
          {!counts ? (online ? 'Live' : 'Connecting…') : counts.registered ? `${counts.registered} registered · ${counts.checkedIn} checked in` : 'Live · be the first to register'}
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
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : fmtTime(new Date(at).getHours() * 60 + new Date(at).getMinutes());
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
  for (const id of [...seenAt.current.keys()]) if (!ids.has(id)) seenAt.current.delete(id);
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
        <ul>
          {entries.map((e) => (
            <li key={e.key} className={`hl ${e.tone}`}>
              <span className="hl-ic">
                <Icon name={e.icon} size={15} />
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
