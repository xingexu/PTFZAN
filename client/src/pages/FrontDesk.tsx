import { useEffect, useRef, useState } from 'react';
import type { Guest, Hvac, Room, SimState } from '../../../shared/types';
import { fmtRange, fmtTime } from '../../../shared/types';
import { useSim, useToast } from '../api';
import { hotel } from '../hotel/host';
import { Icon } from '../components/Icon';
import { fade } from '../components/fade';
import { PageHead } from '../components/PageHead';
import { atRisk, CONF_COLOR, CONF_WIDTH, HVAC_COLOR, HVAC_LABEL, HVAC_TILE, STATUS_COLOR, STATUS_LABEL, TILE_LABEL, visibleStatus } from '../components/rooms';

/** Compact 12-hour clock for tiles, e.g. 1:05 */
const clock = (m: number) => fmtTime(m).replace(/ (AM|PM)$/, '');

const ISSUES = ['AC not cooling', 'Plumbing leak', 'TV not working', 'Door lock fault', 'Heating failure'];
const SURE = { high: 'Very likely', medium: 'Likely', low: 'Rough guess' } as const;
type Layer = 'readiness' | 'climate';

export default function FrontDesk() {
  const { state } = useSim();
  const [sel, setSel] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>('readiness');
  if (!state) return null;
  const ai = state.mode === 'ai';
  const floors = [6, 5, 4, 3];
  const selected = sel ? state.rooms.find((r) => r.id === sel) : undefined;

  return (
    <main className="page fit">
      <PageHead title="Rooms">
        <div className="layer-seg" role="tablist" aria-label="Map layer">
          <button role="tab" aria-selected={layer === 'readiness'} className={layer === 'readiness' ? 'on' : ''} onClick={() => fade(() => setLayer('readiness'))}>
            <Icon name="bed" size={14} /> Room status
          </button>
          <button role="tab" aria-selected={layer === 'climate'} className={layer === 'climate' ? 'on' : ''} onClick={() => fade(() => setLayer('climate'))}>
            <Icon name="thermo" size={14} /> Temperature
          </button>
        </div>
      </PageHead>

      <div className="grid fd">
        <section className="card fd-map" aria-label="Room grid">
          <div className="card-head">
            <Legend layer={layer} ai={ai} />
            {!ai && layer === 'readiness' && <span className="pill red">Last phone update · {fmtTime(state.frontDeskSnapshotAt)}</span>}
            {ai && state.elevatorDown && layer === 'readiness' && <span className="pill amber">Elevator B out · floors 5–6 slower</span>}
            {layer === 'climate' && (
              <span className={`pill ${ai ? 'teal' : 'red'}`}>
                {ai ? `${state.metrics.kwhSaved} kWh of energy saved today` : `${state.metrics.vacantRunning} empty rooms with heat/AC on full`}
              </span>
            )}
          </div>
          <div className="floors fd-floors">
            {floors.map((f) => (
              <div className="floor" key={f}>
                <div className="floor-label">{f}</div>
                {state.rooms
                  .filter((r) => r.floor === f)
                  .map((r) => (
                    <RoomTile key={r.id} s={state} r={r} layer={layer} selected={sel === r.id} onClick={() => fade(() => setSel(sel === r.id ? null : r.id))} />
                  ))}
              </div>
            ))}
          </div>
        </section>

        <aside className="side">
          {selected ? <RoomDetail s={state} r={selected} onClose={() => fade(() => setSel(null))} /> : <Arrivals s={state} onPick={(id) => fade(() => setSel(id))} />}
        </aside>
      </div>
    </main>
  );
}

function Legend({ layer, ai }: { layer: Layer; ai: boolean }) {
  if (layer === 'climate') {
    const keys: Hvac[] = ai ? ['comfort', 'eco', 'precool'] : ['comfort', 'running'];
    return (
      <div className="legend" aria-label="Legend">
        {keys.map((h) => (
          <span key={h}>
            <span className="dot" style={{ background: HVAC_COLOR[h] }} /> {HVAC_LABEL[h]}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="legend" aria-label="Legend">
      {(['ready', 'inspection', 'cleaning', 'dirty', 'occupied', 'ooo'] as const).map((s) => (
        <span key={s}>
          <span className="dot" style={{ background: STATUS_COLOR[s] }} /> {STATUS_LABEL[s]}
        </span>
      ))}
      <span>
        <span className="dot" style={{ background: '#636366' }} /> Wedding
      </span>
      {ai && (
        <span>
          <span className="dot" style={{ background: 'transparent', border: '2px solid var(--red)' }} /> Might be late
        </span>
      )}
    </div>
  );
}

function RoomTile({ s, r, layer, selected, onClick }: { s: SimState; r: Room; layer: Layer; selected: boolean; onClick: () => void }) {
  const st = visibleStatus(s, r);
  const ai = s.mode === 'ai';
  const risk = layer === 'readiness' && atRisk(s, r);
  // Tiles show the promise (late end of the range); the detail panel shows the full range and why.
  let etaText = '';
  if (layer === 'climate') etaText = r.hvac === 'precool' ? 'guest soon' : r.hvac === 'eco' ? 'saving' : '';
  else if (st === 'stayover') etaText = '';
  else if (st === 'ready') etaText = r.readyAt ? `✓ ${clock(r.readyAt)}` : '';
  else if (ai && r.eta) etaText = `by ${clock(r.eta.high)}`;
  else if (ai && st === 'ooo') etaText = r.maintenanceTicket ?? 'Repair';
  else if (!ai) etaText = 'Not sure';
  const cls = layer === 'climate' ? `h-${r.hvac}` : `s-${st}`;
  const label = layer === 'climate' ? HVAC_TILE[r.hvac] : TILE_LABEL[st];

  return (
    <button
      className={`tile ${cls} ${selected ? 'sel' : ''} ${risk ? 'risk' : ''} ${!ai && layer === 'readiness' && st !== 'ready' ? 'unknown' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Room ${r.id}, ${layer === 'climate' ? HVAC_LABEL[r.hvac] : STATUS_LABEL[st]}${etaText ? `, ${etaText}` : ''}${r.groupBlock ? ', wedding block' : ''}`}
    >
      <span className="num">
        {r.id}
        {r.groupBlock && <span className="grp" />}
      </span>
      <span className="st">{label}</span>
      {etaText && <span className="eta">{etaText}</span>}
      {layer === 'readiness' && ai && r.eta && st !== 'stayover' && (
        <span className="conf" title={`How sure: ${SURE[r.eta.confidence]}`}>
          <i style={{ width: CONF_WIDTH[r.eta.confidence], background: CONF_COLOR[r.eta.confidence] }} />
        </span>
      )}
    </button>
  );
}

function RoomDetail({ s, r, onClose }: { s: SimState; r: Room; onClose: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  // When the panel sits below the grid (narrow screens), bring it into view on selection.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [r.id]);
  const [issue, setIssue] = useState(ISSUES[0]);
  const [busy, setBusy] = useState(false);
  const ai = s.mode === 'ai';
  const st = visibleStatus(s, r);
  const guests = s.guests.filter((g) => g.roomId === r.id);
  const att = r.cleaningBy ? s.attendants.find((a) => a.id === r.cleaningBy) : undefined;
  const ticket = r.maintenanceTicket ? s.tickets.find((t) => t.id === r.maintenanceTicket) : undefined;

  const report = async () => {
    setBusy(true);
    try {
      const res = await hotel('issue', { roomId: r.id, issue });
      toast({ title: `Issue reported · ${r.id}`, body: res.message, tone: ai ? 'good' : 'neutral' });
    } catch (e) {
      toast({ title: 'Could not report issue', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card detail" aria-label={`Room ${r.id} details`} ref={ref}>
      <div className="card-head">
        <h2>
          Room {r.id} <span className="muted" style={{ fontWeight: 600 }}>· {r.type}</span>
        </h2>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close room details">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="eyebrow">{st === 'ready' ? 'Ready' : ai ? 'Expected ready' : 'Status'}</div>
          {st === 'ready' ? (
            <div className="eta-big" style={{ color: 'var(--green-ink)' }}>Ready{r.readyAt ? ` · ${fmtTime(r.readyAt)}` : ''}</div>
          ) : ai && r.eta ? (
            <div className="row wrap">
              <div className="eta-big">{fmtRange(r.eta.low, r.eta.high)}</div>
              <span className={`pill ${r.eta.confidence === 'high' ? 'green' : r.eta.confidence === 'medium' ? 'amber' : 'red'}`}>{SURE[r.eta.confidence]}</span>
            </div>
          ) : ai ? (
            <div className="eta-big" style={{ fontSize: 18 }}>{st === 'ooo' ? 'Being repaired' : st === 'stayover' ? 'Guest staying on — no arrival' : 'Not on today’s list'}</div>
          ) : (
            <div className="eta-big" style={{ fontSize: 18, color: 'var(--red-ink)' }}>Unknown — call housekeeping to check</div>
          )}
        </div>

        {ai && r.eta && (
          <div>
            <div className="row" style={{ gap: 6 }}>
              <span className="ai-chip">
                <Icon name="sparkles" size={12} /> Why this time
              </span>
            </div>
            <ul className="why">
              {r.eta.drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        <dl>
          <dt>Status</dt>
          <dd>
            {STATUS_LABEL[st]}
            {!ai && st !== r.status ? <span className="muted"> (may be outdated)</span> : null}
          </dd>
          {ai && att && (
            <>
              <dt>Being cleaned</dt>
              <dd>{att.label}</dd>
            </>
          )}
          {r.scheduledCheckout && r.status === 'occupied' && (
            <>
              <dt>Checkout</dt>
              <dd>{r.lateReported ? `Late · ${fmtTime(r.actualCheckout!)}` : `By ${fmtTime(r.scheduledCheckout)}`}</dd>
            </>
          )}
          <dt>Temperature</dt>
          <dd>
            <span className="dot" style={{ background: HVAC_COLOR[r.hvac], marginRight: 6 }} />
            {HVAC_LABEL[r.hvac]}
          </dd>
          {ticket && (
            <>
              <dt>Repair</dt>
              <dd>
                {ticket.id} · {ticket.issue}
              </dd>
            </>
          )}
        </dl>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Guests</div>
          {guests.length === 0 ? <div className="muted" style={{ fontSize: 13.5 }}>No arrival assigned.</div> : guests.map((g) => <GuestLine key={g.code} s={s} g={g} />)}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <label htmlFor="issue" className="eyebrow">
            Report a problem in this room
          </label>
          <div className="row" style={{ marginTop: 6 }}>
            <select id="issue" className="input" value={issue} onChange={(e) => setIssue(e.target.value)}>
              {ISSUES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <button className="btn danger" disabled={busy || r.status === 'ooo'} onClick={report}>
              <Icon name="wrench" size={14} /> Report
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuestLine({ s, g }: { s: SimState; g: Guest }) {
  const notes = s.notifications.filter((n) => n.guestCode === g.code);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
      <div>
        <b>{g.name}</b> <span className="muted">· {g.partySize}p</span>
        <div className="muted" style={{ fontSize: 12 }}>
          {g.inHouse ? 'In-house guest' : `Arrives ~${fmtTime(g.arrivalTime)}`} · {g.consentSms ? `Texts to ${g.phoneMasked}` : g.isDemoGuest ? 'Guest app messages' : 'No texts (declined)'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <GuestPill g={g} />
        {notes.length > 0 && <div className="muted" style={{ fontSize: 11.5 }}>{notes.length} msg sent</div>}
      </div>
    </div>
  );
}

export function GuestPill({ g }: { g: Guest }) {
  const map = {
    expected: ['slate', 'Expected'],
    waiting: ['red', 'Waiting in lobby'],
    'informed-away': ['violet', 'Out · has a time'],
    'checked-in': ['green', g.inHouse ? 'In house' : 'Checked in'],
  } as const;
  const [c, t] = map[g.state];
  return <span className={`pill ${c}`}>{t}</span>;
}

function Arrivals({ s, onPick }: { s: SimState; onPick: (id: string) => void }) {
  const ai = s.mode === 'ai';
  const pending = s.guests.filter((g) => !g.isDemoGuest && !g.inHouse && g.state !== 'checked-in');
  // Guests due after the 5 PM end of the shift record are listed separately.
  const evening = pending.filter((g) => g.state === 'expected' && g.arrivalTime > s.end);
  const list = pending
    .filter((g) => !evening.includes(g))
    .sort((a, b) => (a.state === 'waiting' ? -1 : 0) - (b.state === 'waiting' ? -1 : 0) || a.arrivalTime - b.arrivalTime);
  return (
    <>
      {s.finished && <ShiftSummary s={s} />}
      <section className="card" aria-label="Front desk agents">
        <div className="card-head">
          <h2>Front desk staff</h2>
        </div>
        <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.deskAgents.map((d, i) => {
            const task = s.now < d.busyUntil ? d.task : 'Available';
            return (
              <div key={d.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13.5 }}>
                <b>Desk {i + 1}</b>
                <span className={`pill ${task.startsWith('Calling') || task.startsWith('Taking') ? 'red' : task === 'Available' ? 'slate' : 'ai'}`}>{task}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card" aria-label="Arrivals">
        <div className="card-head">
          <h2>Guests not in their rooms yet</h2>
          <span className="pill slate">{list.length}</span>
        </div>
        {list.length === 0 ? (
          <div className="empty row" style={{ justifyContent: 'center', color: 'var(--green-ink)', fontWeight: 650 }}>
            <Icon name="check" size={16} /> Everyone who has arrived is in their room.
          </div>
        ) : (
          <ul className="arrivals">
            {list.map((g) => {
              const r = s.rooms.find((x) => x.id === g.roomId)!;
              const vis = visibleStatus(s, r);
              const sent = s.notifications.some((n) => n.guestCode === g.code);
              return (
                <li key={g.code}>
                  <span className="nm">
                    {g.name} <span className="muted" style={{ fontWeight: 600 }}>· {g.partySize}p</span>
                  </span>
                  <GuestPill g={g} />
                  <span className="sub">
                    <button className="btn sm" onClick={() => onPick(r.id)}>
                      Room {r.id}
                    </button>
                    <span>~{fmtTime(g.arrivalTime)}</span>
                    {vis === 'ready' ? (
                      <span style={{ color: 'var(--green-ink)', fontWeight: 700 }}>Room ready</span>
                    ) : ai && r.eta ? (
                      <span className="num" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{fmtRange(r.eta.low, r.eta.high)}</span>
                    ) : (
                      <span className="muted">Ready time unknown</span>
                    )}
                    {ai && (sent ? <span className="pill ai">Texted</span> : !g.consentSms ? <span className="pill slate">No texts</span> : null)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {evening.length > 0 && (
        <section className="card" aria-label="Arriving this evening">
          <div className="card-head">
            <h2>Arriving this evening</h2>
            <span className="pill slate">{evening.length}</span>
          </div>
          <ul className="arrivals">
            {evening.map((g) => {
              const r = s.rooms.find((x) => x.id === g.roomId)!;
              return (
                <li key={g.code}>
                  <span className="nm">
                    {g.name} <span className="muted" style={{ fontWeight: 600 }}>· {g.partySize}p</span>
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>~{fmtTime(g.arrivalTime)}</span>
                  <span className="sub">
                    <button className="btn sm" onClick={() => onPick(r.id)}>
                      Room {r.id}
                    </button>
                    {r.status === 'ready' ? (
                      <span style={{ color: 'var(--green-ink)', fontWeight: 700 }}>Room ready</span>
                    ) : ai && r.eta ? (
                      <span className="num" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{fmtRange(r.eta.low, r.eta.high)}</span>
                    ) : (
                      <span className="muted">{STATUS_LABEL[visibleStatus(s, r)]}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

/** End of the shift record: what the evening team inherits. */
function ShiftSummary({ s }: { s: SimState }) {
  const open = s.rooms.filter((r) => ['occupied', 'dirty', 'cleaning', 'inspection'].includes(r.status) || (r.status === 'stayover' && !r.serviced));
  const ready = s.rooms.filter((r) => r.status === 'ready').length;
  const done = open.length === 0;
  return (
    <section className={`card card-pad summary ${done ? 'good' : 'warn'}`} aria-label="End of shift">
      <span className="pillar-icon">
        <Icon name={done ? 'check' : 'alert'} size={16} />
      </span>
      <div>
        <h2>{done ? 'Every room finished' : `${open.length} rooms left for tonight`}</h2>
        <p className="muted">
          {ready} ready · {s.metrics.lobbyWaiting} waiting{done ? '' : ` · ${open.map((r) => r.id).join(', ')}`}
        </p>
      </div>
    </section>
  );
}
