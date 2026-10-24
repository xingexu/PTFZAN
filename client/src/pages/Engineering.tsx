import type { GuestRequest, MaintenanceInsight, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim } from '../api';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { HVAC_COLOR, HVAC_LABEL, sides } from '../components/rooms';

export default function Engineering() {
  const { state } = useSim();
  if (!state) return null;

  return (
    <main className="page fit">
      <PageHead title="Maintenance" />
      <div className="grid maintenance-layout">
        <Tickets s={state} />
        <Insights insights={state.insights} />
      </div>
    </main>
  );
}

const STEPS: GuestRequest['status'][] = ['received', 'assigned', 'on-the-way', 'resolved'];

function Tickets({ s }: { s: SimState }) {
  const issues = s.requests.filter((r) => r.kind === 'issue');
  const elevator = s.tickets.filter((t) => !s.requests.some((r) => r.ticketId === t.id));
  return (
    <section className="card tickets-card" aria-label="Maintenance tickets">
      <div className="card-head">
        <div className="title">
          <Icon name="wrench" size={16} />
          <h2>Repairs &amp; guest reports</h2>
        </div>
        <span className="pill slate">{s.metrics.ticketsOpen} open</span>
      </div>
      {issues.length === 0 && elevator.length === 0 ? (
        <div className="empty">No repairs yet. Elevator B fails at 12:00 PM; suite 411&rsquo;s AC at 2:05 PM.</div>
      ) : (
        <ul className="tickets card-scroll">
          {elevator.map((t) => (
            <li key={t.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {t.id} · {t.asset}
                </b>
                <span className={`pill ${t.status === 'open' ? 'amber' : 'green'}`}>{t.status}</span>
              </div>
              <span>{t.issue}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                Opened {fmtTime(t.openedAt)} · {t.owner}
                {s.mode === 'ai' ? ` · ${t.impact}` : ''}
              </span>
            </li>
          ))}
          {issues.map((r) => {
            const idx = STEPS.indexOf(r.status);
            const guest = s.guests.find((g) => g.code === r.guestCode);
            return (
              <li key={r.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>
                    {r.ticketId ? `${r.ticketId} · ` : ''}
                    {r.title} · room {r.roomId}
                  </b>
                  <span className={`pill ${r.status === 'resolved' ? 'green' : r.owner ? 'ai' : 'red'}`}>{r.status === 'resolved' ? `fixed ${r.resolvedAt ? fmtTime(r.resolvedAt) : ''}` : r.status.replace(/-/g, ' ')}</span>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Reported {fmtTime(r.openedAt)} by {guest?.name.split(' ')[0] ?? 'guest'} · {r.owner ? `handled by ${r.owner}` : 'nobody assigned yet'}
                  {r.etaAt ? ` · promised for ${fmtTime(r.etaAt)}` : ' · no time given'}
                </span>
                <div className={`track ${r.status === 'resolved' ? 'done' : ''}`} aria-hidden="true">
                  {STEPS.map((st, i) => (
                    <span key={st} className={i <= idx ? 'on' : ''} />
                  ))}
                </div>
                {r.reports > 1 && (
                  <span style={{ color: 'var(--red-ink)', fontWeight: 700, fontSize: 12 }}>
                    <Icon name="alert" size={12} /> Guest had to report this {r.reports} times
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Insights({ insights }: { insights: MaintenanceInsight[] }) {
  return (
    <section className="card fill" aria-label="Recurring faults">
      <div className="card-head">
        <div className="title">
          <Icon name="sparkles" size={16} />
          <h2 title="Repair notes are typed differently by different people. FHN AI reads each into what · where · problem so repeats stand out.">Recurring maintenance issues</h2>
        </div>
        <span className="sub">Last 60 days</span>
      </div>
      <div className="card-scroll">
      {insights.map((i) => (
        <div className="insight" key={`${i.asset}-${i.location}`}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <b>
                {i.location === i.asset ? i.asset : `${i.asset} · ${i.location}`} — {i.fault}
              </b>
              <div className="muted" style={{ fontSize: 12.5 }}>{i.recommendation}</div>
            </div>
            <span className={`pill ${i.severity === 'high' ? 'red' : 'amber'}`}>
              {i.occurrences} times in {i.windowDays} days
            </span>
          </div>
          <details className="repair-notes"><summary>View {i.examples.length} related repair notes</summary><ul className="raw">
            {i.examples.map((e) => (
              <li key={e.date + e.raw}>
                <span className="muted num">{e.date.slice(5)}</span>
                <span>
                  <code>{e.raw}</code> <span className="muted">→ {i.location === i.asset ? i.asset : `${i.asset} · ${i.location}`} · {i.fault}</span>
                </span>
              </li>
            ))}
          </ul></details>
        </div>
      ))}
      </div>
    </section>
  );
}

function Energy({ s }: { s: SimState }) {
  const { ai, today } = sides(s);
  const floors = [6, 5, 4, 3];
  const count = (h: string) => s.rooms.filter((r) => r.hvac === h).length;
  return (
    <section className="card fill energy-card" aria-label="Room climate">
      <div className="card-head">
        <div className="title">
          <Icon name="leaf" size={16} />
          <h2>Room temperature · live</h2>
        </div>
        <span className={`pill ${s.mode === 'ai' ? 'teal' : 'red'}`}>{s.mode === 'ai' ? 'Saves energy when empty' : 'Previous method: always on'}</span>
      </div>
      <div className="energy-hero"><div><span className="page-eyebrow">ENERGY SAVED TODAY</span><strong>{ai?.kwhSaved ?? 0}<small> kWh</small></strong><p>saved today · previous method {today?.kwhSaved ?? 0} kWh</p></div><div className="energy-orb"><Icon name="leaf" size={38} /></div></div>
      <div className="estats">
        <div className="fstat">
          <b>{s.mode === 'ai' ? count('eco') : count('running')}</b>
          <span>{s.mode === 'ai' ? 'empty rooms saving energy now' : 'empty rooms with heat/AC on full'}</span>
        </div>
        <div className="fstat">
          <b>{ai?.preconditioned ?? 0}</b>
          <span>guests arrived to the right temperature</span>
        </div>
      </div>
      <div className="climate-caption"><b>Room temperature</b><span>Live temperature settings</span></div>
      <div className="climate-grid" aria-label="Rooms by temperature setting">
        {floors.map((f) => (
          <div className="cg-floor" key={f}>
            <span className="floor-label" style={{ fontSize: 11 }}>
              {f}
            </span>
            {s.rooms
              .filter((r) => r.floor === f)
              .map((r) => (
                <span key={r.id} className={`cg-room h-${r.hvac}`} title={`${r.id} · ${HVAC_LABEL[r.hvac]}`}>
                  {r.id.slice(-2)}
                </span>
              ))}
          </div>
        ))}
        <div className="legend" style={{ marginTop: 8 }}>
          {(s.mode === 'ai' ? (['comfort', 'eco', 'precool'] as const) : (['comfort', 'running'] as const)).map((h) => (
            <span key={h}>
              <span className="dot" style={{ background: HVAC_COLOR[h] }} /> {HVAC_LABEL[h]}
            </span>
          ))}
        </div>
      </div>
      <div className="energy-comfort-note"><Icon name="shield" size={16} /><span>{s.mode === 'ai' ? 'Empty rooms use energy-saving settings until guests arrive.' : 'Heating and cooling remain on, even when rooms are empty.'}</span></div>
    </section>
  );
}

export function EnergyPage() {
  const { state } = useSim();
  if (!state) return null;
  return <main className="page energy-page"><PageHead title="Energy" /><Energy s={state} /></main>;
}
