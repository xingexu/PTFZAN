import type { ReactNode } from 'react';
import type { Metrics, SimState } from '../../../shared/types';
import { fmt24 } from '../../../shared/types';
import { useSim } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { JoinQr } from '../components/JoinQr';
import { sides } from '../components/rooms';

type M = Metrics | null;

export default function Overview() {
  const { state } = useSim();
  if (!state) return null;
  const { ai, today } = sides(state);
  const acReported = state.now >= 14 * 60 + 5;
  const flagged = state.insights.filter((i) => i.severity === 'high').length;

  return (
    <main className="page">
      <div className="ov-head">
        <div>
          <h1>Friday, October 16 · Toronto Downtown</h1>
          <p>The shift record from Exhibit 4, 8:00 AM–5:00 PM · Chen–Okafor wedding, 20 rooms, 40 guests. Each card compares FHN AI with the same day run today&rsquo;s way.</p>
        </div>
      </div>

      <section className="pillars" aria-label="The four operational challenges">
        <Pillar
          lead
          icon="bed"
          tone="ai"
          title="Room readiness"
          sub="Housekeeping ↔ front desk"
          rows={[
            row('Wedding guests waiting in the lobby', ai, today, (m) => m.groupWaiting, { lowerIsBetter: true }),
            row('Wedding rooms ready by 3 PM', ai, today, (m) => m.groupRoomsReadyBy1500, { unit: '/20' }),
          ]}
          note={`Ready-time promises kept: ${ai?.etaAccuracyPct ?? '—'}${ai?.etaAccuracyPct != null ? '%' : ''} · ${ai?.notificationsSent ?? 0} messages to guests`}
        />
        <Pillar
          icon="users"
          tone="violet"
          title="Labour"
          sub="Same staff, no wasted trips"
          rows={[
            row('Time lost knocking on occupied rooms', ai, today, (m) => m.attendantMinLost, { unit: 'min', lowerIsBetter: true }),
            row('Staff pulled off other jobs', ai, today, (m) => m.pulledStaffMin, { unit: 'min', lowerIsBetter: true }),
          ]}
          note="Sick call: backup attendant booked at 8:00 from the forecast, not found out at 3:45"
        />
        <Pillar
          icon="wrench"
          tone="amber"
          title="Maintenance"
          sub="One report, one owner"
          rows={[
            row('Suite 411 AC fixed in', ai, today, (m) => (acReported ? m.acFixMin : null), { unit: 'min', lowerIsBetter: true, none: acReported ? 'open' : '—' }),
            row('Times the guest had to report it', ai, today, (m) => (acReported ? 1 + m.repeatReports : null), { lowerIsBetter: true, none: '—' }),
          ]}
          note={`${flagged} repeat problems spotted in old repair notes`}
        />
        <Pillar
          icon="leaf"
          tone="teal"
          title="Energy"
          sub="Empty rooms save energy"
          rows={[
            row('Energy saved in empty rooms', ai, today, (m) => m.kwhSaved, { unit: 'kWh' }),
            row('Empty rooms with heat/AC on full', ai, today, (m) => m.vacantRunning, { lowerIsBetter: true }),
          ]}
          note={`${ai?.preconditioned ?? 0} guests walked into a room already at the right temperature`}
        />
      </section>

      <div className="ov-main">
        <Lobbies ai={ai} today={today} />
        <div className="side-col">
          <JoinQr />
          <ShiftLog state={state} />
        </div>
      </div>
    </main>
  );
}

interface Row {
  label: string;
  ai: ReactNode;
  today: ReactNode;
  worse: boolean;
}

function row(
  label: string,
  ai: M,
  today: M,
  get: (m: Metrics) => number | null,
  opts: { unit?: string; lowerIsBetter?: boolean; zero?: string; none?: string } = {},
): Row {
  // "/20" hugs the number; "min" and "kWh" get a space.
  const suffix = !opts.unit ? '' : opts.unit.startsWith('/') ? opts.unit : ` ${opts.unit}`;
  const show = (m: M, big: boolean): ReactNode => {
    if (!m) return '—';
    const v = get(m);
    if (v === null) return opts.none ?? '—';
    if (v === 0 && opts.zero) return opts.zero;
    if (!big) return `${v}${suffix}`;
    return (
      <>
        {v}
        {opts.unit && <small>{opts.unit}</small>}
      </>
    );
  };
  const a = ai ? get(ai) : null;
  const b = today ? get(today) : null;
  const worse = a !== null && b !== null && (opts.lowerIsBetter ? b > a : b < a);
  return { label, ai: show(ai, true), today: show(today, false), worse };
}

function Pillar({ icon, tone, title, sub, rows, note, lead }: { icon: IconName; tone: string; title: string; sub: string; rows: Row[]; note: string; lead?: boolean }) {
  return (
    <article className={`card pillar ${lead ? 'lead' : ''}`}>
      <div className="pillar-top">
        <span className={`pillar-icon tone-${tone}`}>
          <Icon name={icon} size={17} />
        </span>
        <span className="pillar-title">
          {title}
          <small>{sub}</small>
        </span>
        {lead && <span className="pill ai lead-tag">Priority</span>}
      </div>
      {rows.map((r) => (
        <div className="pm" key={r.label}>
          <span className="pm-label">{r.label}</span>
          <span className="pm-ai">{r.ai}</span>
          <span className="pm-today">Today {r.worse ? <b>{r.today}</b> : r.today}</span>
        </div>
      ))}
      <div className="pillar-note">
        <Icon name="sparkles" size={13} />
        <span>{note}</span>
      </div>
    </article>
  );
}

function Lobbies({ ai, today }: { ai: M; today: M }) {
  return (
    <section className="card" aria-label="Wedding party, side by side">
      <div className="card-head">
        <div className="title">
          <Icon name="users" size={16} />
          <h2>Wedding party · 40 guests</h2>
        </div>
        <span className="sub">Same arrivals, two ways of running the day</span>
      </div>
      <div className="lobbies">
        <LobbyPanel title="Today’s way" pill={<span className="pill red">Phone calls</span>} m={today} />
        <LobbyPanel title="With FHN AI" pill={<span className="pill ai">Live ready times</span>} m={ai} />
      </div>
      <div className="lobby-foot">
        <span>
          <span className="dot" style={{ background: 'var(--red)' }} /> Waiting in the lobby, no answer
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--violet)' }} /> Knows when their room will be ready, out for lunch
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--green)' }} /> In their room
        </span>
      </div>
    </section>
  );
}

function LobbyPanel({ title, pill, m }: { title: string; pill: ReactNode; m: M }) {
  return (
    <div className="lobby-panel">
      <h3>
        <span>{title}</span>
        {pill}
      </h3>
      <Zone label="Waiting in lobby" n={m?.groupWaiting ?? 0} cls="waiting" />
      <Zone label="Out, has a time" n={m?.groupAway ?? 0} cls="away" />
      <Zone label="In their rooms" n={m?.groupIn ?? 0} cls="in" />
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        {m && m.groupExpected > 0 ? `${m.groupExpected} not arrived yet` : m ? `Avg lobby wait ${m.avgWaitMin} min · longest ${m.longestWaitMin} min` : ''}
      </div>
    </div>
  );
}

function Zone({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div className="lzone">
      <span className="lzone-label">{label}</span>
      <span className="people" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={`person ${cls}`} />
        ))}
      </span>
      <span className="lzone-n">{n}</span>
    </div>
  );
}

function ShiftLog({ state }: { state: SimState }) {
  return (
    <section className="card" aria-label="Shift log">
      <div className="card-head">
        <h2>Shift log</h2>
        <span className="sub">{state.mode === 'ai' ? 'With FHN AI' : 'Today’s way'} · newest first</span>
      </div>
      <ul className="log">
        {state.log.map((l) => (
          <li key={`${l.at}-${l.dept}-${l.text}`} className={l.tone}>
            <span className="t">{fmt24(l.at)}</span>
            <span>
              <span className="dept">{l.dept}</span>
              {l.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
