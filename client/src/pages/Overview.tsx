import type { Guest, SimState } from '../../../shared/types';
import { fmt24 } from '../../../shared/types';
import { useSim } from '../api';
import { JoinQr } from '../components/JoinQr';

export default function Overview() {
  const { state } = useSim();
  if (!state) return null;
  const m = state.metrics;
  const rp = state.mode === 'readypath';

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Friday, October 16 · Wedding arrivals</h1>
          <p>
            {rp
              ? 'Same sick call, same late checkouts, same elevator failure, same wedding. This time every department works from one predicted readiness view.'
              : 'The shift as it happened: each department responds to its own responsibilities, coordinating by phone.'}
          </p>
        </div>
        <span className={`pill ${rp ? 'teal' : 'red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
          {rp ? 'With ReadyPath' : 'Today’s process'}
        </span>
      </div>

      <section className="kpis" aria-label="Key measures">
        <Kpi label="In the lobby now" value={m.lobbyWaiting} unit="guests" note={`Peak ${m.lobbyPeak} today`} tone={m.lobbyWaiting >= 10 ? 'bad' : undefined} />
        <Kpi label="Informed & away" value={m.informedAway} unit="guests" note="Have an ETA, not queueing" />
        <Kpi label="Wedding rooms ready by 3 PM" value={m.groupRoomsReadyBy1500} unit={`/ ${m.groupRoomsTotal}`} note={`${m.groupRoomsNotReady} still in progress`} />
        <Kpi label="Avg lobby wait" value={m.avgWaitMin} unit="min" note={`Longest ${m.longestWaitMin} min`} tone={m.avgWaitMin >= 15 ? 'bad' : undefined} />
        <Kpi label="Readiness phone calls" value={m.readinessCalls} note={`${m.wastedVisits} wasted room visits`} tone={m.readinessCalls > 3 ? 'bad' : 'good'} />
        <Kpi
          label="ETA promises kept"
          value={m.etaAccuracyPct === null ? '—' : m.etaAccuracyPct}
          unit={m.etaAccuracyPct === null ? '' : '%'}
          note={rp ? `${m.etaScored} rooms scored · ${m.notificationsSent} messages sent` : 'No ETAs are given today'}
          tone={m.etaAccuracyPct !== null && m.etaAccuracyPct >= 80 ? 'good' : undefined}
        />
      </section>

      <div className="grid overview" style={{ marginTop: 16 }}>
        <div className="grid">
          <Lobby state={state} />
          <JoinQr />
        </div>
        <section className="card" aria-label="Shift log">
          <div className="card-head">
            <h2>Shift log</h2>
            <span className="muted" style={{ fontSize: 13 }}>Newest first</span>
          </div>
          <ul className="log">
            {state.log.map((l, i) => (
              <li key={`${l.at}-${i}-${l.text.length}`} className={l.tone}>
                <span className="t">{fmt24(l.at)}</span>
                <span>
                  <span className="dept">{l.dept}</span>
                  {l.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, unit, note, tone }: { label: string; value: number | string; unit?: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`card kpi ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function Lobby({ state }: { state: SimState }) {
  const real = state.guests.filter((g) => !g.isDemoGuest && g.group);
  const people = (f: (g: Guest) => boolean) => real.filter(f).flatMap((g) => Array.from({ length: g.partySize }, (_, i) => `${g.code}-${i}`));
  const waiting = people((g) => g.state === 'waiting');
  const away = people((g) => g.state === 'informed-away');
  const inRoom = people((g) => g.state === 'checked-in');
  const expected = people((g) => g.state === 'expected');

  return (
    <section className="card lobby" aria-label="Wedding party status">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Wedding party · 40 guests</h2>
        <span className="muted" style={{ fontSize: 13 }}>{expected.length} not yet arrived</span>
      </div>
      <div className="lobby-zones">
        <Zone title="Waiting in lobby" ids={waiting} cls="waiting" />
        <Zone title="Informed, not queueing" ids={away} cls="away" />
        <Zone title="In their rooms" ids={inRoom} cls="in" />
      </div>
    </section>
  );
}

function Zone({ title, ids, cls }: { title: string; ids: string[]; cls: string }) {
  return (
    <div className="zone">
      <h4>
        <span>{title}</span>
        <span className="mono">{ids.length}</span>
      </h4>
      <div className="people" aria-hidden="true">
        {ids.map((id) => (
          <span key={id} className={`person ${cls}`} />
        ))}
      </div>
    </div>
  );
}
