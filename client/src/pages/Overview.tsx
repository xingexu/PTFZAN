import { useEffect, useRef, useState } from 'react';
import type { Metrics, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { JoinQr } from '../components/JoinQr';
import { sides } from '../components/rooms';

type M = Metrics | null;
const SEATS = 40;

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

export default function Overview() {
  const { state } = useSim();
  if (!state) return null;
  const { ai, today } = sides(state);
  const acDone = state.now >= 14 * 60 + 5;
  const wasted = (m: M) => (m ? m.attendantMinLost + m.pulledStaffMin : 0);

  return (
    <main className="page live">
      <section className="versus" aria-label="The wedding party, side by side">
        <Lobby kind="today" m={today} stat={today ? `${today.readinessCalls} calls to housekeeping` : ''} />
        <div className="vs" aria-hidden="true">
          <span>vs</span>
        </div>
        <Lobby kind="ai" m={ai} stat={ai?.etaAccuracyPct != null ? `${ai.etaAccuracyPct}% of ready times kept` : `${ai?.notificationsSent ?? 0} messages to guests`} />
      </section>

      <section className="wins" aria-label="The four challenges">
        <Win icon="bed" tone="ai" label="Wedding rooms ready by 3 PM" ai={ai?.groupRoomsReadyBy1500} today={today?.groupRoomsReadyBy1500} unit="/20" higherIsBetter />
        <Win icon="users" tone="violet" label="Staff time wasted" ai={wasted(ai)} today={wasted(today)} unit="min" />
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

function Lobby({ kind, m, stat }: { kind: 'today' | 'ai'; m: M; stat: string }) {
  const waiting = m?.groupWaiting ?? 0;
  const away = m?.groupAway ?? 0;
  const inRoom = m?.groupIn ?? 0;
  const seat = (i: number) => (i < inRoom ? 'in' : i < inRoom + away ? 'away' : i < inRoom + away + waiting ? 'waiting' : '');
  return (
    <div className={`lobby ${kind}`}>
      <div className="lb-head">
        <span className="lb-name">
          {kind === 'ai' && <Icon name="sparkles" size={14} />}
          {kind === 'ai' ? 'With FHN AI' : 'Today’s way'}
        </span>
        <span className="lb-stat">{stat}</span>
      </div>
      <div className="lb-big">
        <span className="lb-num">
          <Num value={waiting} />
        </span>
        <span className="lb-label">waiting in the lobby</span>
      </div>
      <div className="crowd" aria-hidden="true">
        {Array.from({ length: SEATS }, (_, i) => (
          <span key={i} className={`seat ${seat(i)}`} />
        ))}
      </div>
      <div className="lb-key">
        <span>
          <i className="in" /> {inRoom} in rooms
        </span>
        <span>
          <i className="away" /> {away} out with a time
        </span>
        <span>
          <i className="waiting" /> {waiting} waiting
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
    <div className={`win tone-${tone}`}>
      <span className="win-ic">
        <Icon name={icon} size={16} />
      </span>
      <span className="win-label">{label}</span>
      <span className="win-num">
        {has ? <Num value={ai} /> : pending}
        {has && <small>{unit}</small>}
      </span>
      <span className={`win-today ${worse ? 'worse' : ''}`}>
        Today {today != null ? `${today}${unit.startsWith('/') ? unit : ` ${unit}`}` : pending}
      </span>
    </div>
  );
}

function Feed({ state }: { state: SimState }) {
  return (
    <section className="feed" aria-label="Live feed">
      <h2>Live feed</h2>
      <ul>
        {state.log.slice(0, 5).map((l) => (
          <li key={`${l.at}-${l.dept}-${l.text}`} className={l.tone}>
            <span className="t">{fmtTime(l.at).replace(/ (AM|PM)$/, '')}</span>
            <span className="x">{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
