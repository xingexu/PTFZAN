import { useEffect, useRef, useState } from 'react';
import type { CompareSnapshot, Metrics, RoomStatus, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { JoinQr } from '../components/JoinQr';
import { sides } from '../components/rooms';

type M = Metrics | null;
type BoardRoom = CompareSnapshot['rooms'][number];
const SEATS = 40;
const FLOORS = [6, 5, 4, 3];
const LEGEND: [string, string][] = [
  ['ready', 'Ready'],
  ['cleaning', 'Cleaning'],
  ['inspection', 'Final check'],
  ['dirty', 'To clean'],
  ['occupied', 'Guest in'],
];

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
  const acDone = state.now >= 14 * 60 + 5;
  const wasted = (m: M) => (m ? m.attendantMinLost + m.pulledStaffMin : 0);

  return (
    <main className="page live">
      <section className="versus" aria-label="Every room, side by side">
        <Board kind="today" rooms={todayRooms} m={today} now={state.now} />
        <div className="vs" aria-hidden="true">
          <span>vs</span>
        </div>
        <Board kind="ai" rooms={aiRooms} m={ai} now={state.now} />
        <div className="legend" aria-hidden="true">
          {LEGEND.map(([k, label]) => (
            <span key={k}>
              <i className={`s-${k}`} /> {label}
            </span>
          ))}
          <span>
            <i className="wed-key" /> Wedding party
          </span>
        </div>
      </section>

      <section className="wins" aria-label="The four challenges">
        <Win icon="users" tone="red" label="Most guests waiting at once" ai={ai?.lobbyPeak} today={today?.lobbyPeak} unit="" />
        <Win icon="clock" tone="violet" label="Staff time wasted" ai={wasted(ai)} today={wasted(today)} unit="min" />
        <Win icon="wrench" tone="amber" label="Suite 411 AC fixed in" ai={acDone ? ai?.acFixMin ?? null : null} today={acDone ? today?.acFixMin ?? null : null} unit="min" pending={acDone ? 'open' : '—'} />
        <Win icon="leaf" tone="teal" label="Energy saved" ai={ai?.kwhSaved} today={today?.kwhSaved} unit="kWh" higherIsBetter />
      </section>

      <aside className="live-side">
        <JoinQr />
        <Feed state={state} />
      </aside>
    </main>
  );
}

/** One side of the comparison: all 48 rooms, floor by floor, plus the wedding party in the lobby. */
function Board({ kind, rooms, m, now }: { kind: 'today' | 'ai'; rooms: BoardRoom[]; m: M; now: number }) {
  const pops = usePops(rooms, now);
  const wedding = rooms.filter((r) => r.groupBlock);
  const ready = wedding.filter((r) => r.status === 'ready').length;
  const waiting = m?.groupWaiting ?? 0;
  const away = m?.groupAway ?? 0;
  const inRoom = m?.groupIn ?? 0;
  const seat = (i: number) => (i < inRoom ? 'in' : i < inRoom + away ? 'away' : i < inRoom + away + waiting ? 'waiting' : '');

  return (
    <div className={`board glass ${kind}`}>
      <div className="bd-head">
        <span className="bd-name">
          {kind === 'ai' && <Icon name="sparkles" size={14} />}
          {kind === 'ai' ? 'With FHN AI' : 'Today’s way'}
        </span>
        <span className="bd-big" aria-label={`${ready} of ${wedding.length || 20} wedding rooms ready`}>
          <span className="bd-num">
            <Num value={ready} />
          </span>
          <span className="bd-of">/{wedding.length || 20}</span>
          <span className="bd-label">wedding rooms ready</span>
        </span>
      </div>

      <div className="floors" aria-hidden="true">
        {FLOORS.map((f) => (
          <div className="floor" key={f}>
            <span className="fl-n">{f}</span>
            {rooms
              .filter((r) => r.id.startsWith(String(f)))
              .map((r) => (
                <span key={r.id} className={`rm s-${r.status === 'stayover' ? 'occupied' : r.status} ${r.groupBlock ? 'wed' : ''} ${pops[r.id] ? 'popped' : ''}`}>
                  <span className="rm-in" key={pops[r.id] ?? 0}>
                    {r.id.slice(1)}
                  </span>
                </span>
              ))}
          </div>
        ))}
      </div>

      <div className="lobby-strip" aria-label={`${waiting} wedding guests waiting in the lobby`}>
        <span className="ls-label">Lobby</span>
        <span className="ls-seats" aria-hidden="true">
          {Array.from({ length: SEATS }, (_, i) => (
            <i key={i} className={seat(i)} />
          ))}
        </span>
        <span className={`ls-num ${waiting ? 'hot' : ''}`}>
          <Num value={waiting} /> <small>waiting</small>
        </span>
      </div>
    </div>
  );
}

function Win({
  icon, tone, label, ai, today, unit, higherIsBetter, pending = '—',
}: { icon: IconName; tone: string; label: string; ai?: number | null; today?: number | null; unit: string; higherIsBetter?: boolean; pending?: string }) {
  const has = ai !== undefined && ai !== null;
  const worse = has && today != null && (higherIsBetter ? today < ai : today > ai);
  return (
    <div className={`win glass tone-${tone}`}>
      <span className="win-ic">
        <Icon name={icon} size={16} />
      </span>
      <span className="win-label">{label}</span>
      <span className="win-num">
        {has ? <Num value={ai} /> : pending}
        {has && unit && <small>{unit}</small>}
      </span>
      <span className={`win-today ${worse ? 'worse' : ''}`}>
        Today {today != null ? `${today}${unit ? ` ${unit}` : ''}` : pending}
      </span>
    </div>
  );
}

function Feed({ state }: { state: SimState }) {
  return (
    <section className="feed glass" aria-label="Live feed">
      <h2>Live feed</h2>
      <ul>
        {state.log.slice(0, 4).map((l) => (
          <li key={`${l.at}-${l.dept}-${l.text}`} className={l.tone}>
            <span className="t">{fmtTime(l.at).replace(/ (AM|PM)$/, '')}</span>
            <span className="x">{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
