import { useMemo, useState } from 'react';
import type { Guest, Room, SimState } from '../../../shared/types';
import { fmtRange, fmtTime } from '../../../shared/types';
import { api, useSim, useToast } from '../api';
import { atRisk, CONF_COLOR, CONF_WIDTH, STATUS_COLOR, STATUS_LABEL, TILE_LABEL, visibleStatus } from '../components/rooms';

/** Compact 12-hour clock for tiles, e.g. 1:05 */
const clock = (m: number) => fmtTime(m).replace(/ (AM|PM)$/, '');

const ISSUES = ['AC not cooling', 'Plumbing leak', 'TV not working', 'Door lock fault', 'Heating failure'];

export default function FrontDesk() {
  const { state } = useSim();
  const [sel, setSel] = useState<string | null>(null);
  if (!state) return null;
  const rp = state.mode === 'readypath';
  const floors = [6, 5, 4, 3];
  const selected = sel ? state.rooms.find((r) => r.id === sel) : undefined;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Front desk</h1>
          <p>
            {rp
              ? 'Every agent sees the same live status and predicted ready-time range for every room. Click a room to see why.'
              : `Agents only know what the last update told them. Status as of ${fmtTime(state.frontDeskSnapshotAt)}.`}
          </p>
        </div>
        <div className="legend" aria-label="Legend">
          {(['ready', 'inspection', 'cleaning', 'dirty', 'occupied', 'stayover', 'ooo'] as const).map((s) => (
            <span key={s}>
              <span className="dot" style={{ background: STATUS_COLOR[s] }} /> {STATUS_LABEL[s]}
            </span>
          ))}
          <span>
            <span className="dot" style={{ background: 'var(--violet)' }} /> Wedding block
          </span>
          {rp && (
            <span>
              <span className="dot" style={{ background: 'transparent', border: '2px solid var(--red)' }} /> At risk
            </span>
          )}
        </div>
      </div>

      <div className="grid fd">
        <section className="card" aria-label="Room grid">
          <div className="card-head">
            <h2>Rooms by floor</h2>
            {!rp && <span className="pill red">Last phoned-in status · {fmtTime(state.frontDeskSnapshotAt)}</span>}
            {rp && state.elevatorDown && <span className="pill amber">Elevator B out · floors 5–6 slower</span>}
          </div>
          <div className="floors">
            {floors.map((f) => (
              <div className="floor" key={f}>
                <div className="floor-label">{f}</div>
                {state.rooms
                  .filter((r) => r.floor === f)
                  .map((r) => (
                    <RoomTile key={r.id} s={state} r={r} selected={sel === r.id} onClick={() => setSel(sel === r.id ? null : r.id)} />
                  ))}
              </div>
            ))}
          </div>
        </section>

        <aside className="side">
          {selected ? <RoomDetail s={state} r={selected} onClose={() => setSel(null)} /> : <Arrivals s={state} onPick={setSel} />}
        </aside>
      </div>
    </main>
  );
}

function RoomTile({ s, r, selected, onClick }: { s: SimState; r: Room; selected: boolean; onClick: () => void }) {
  const st = visibleStatus(s, r);
  const rp = s.mode === 'readypath';
  const risk = atRisk(s, r);
  // Tiles show the promise (late end of the range); the detail panel shows the full range and why.
  let etaText = '';
  if (st === 'stayover') etaText = '';
  else if (st === 'ready') etaText = r.readyAt ? `✓ ${clock(r.readyAt)}` : '';
  else if (rp && r.eta) etaText = `by ${clock(r.eta.high)}`;
  else if (rp && st === 'ooo') etaText = r.maintenanceTicket ?? 'Ticket';
  else if (!rp) etaText = 'Call HK';

  return (
    <button
      className={`tile s-${st} ${selected ? 'sel' : ''} ${risk ? 'risk' : ''} ${!rp && st !== 'ready' ? 'unknown' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Room ${r.id}, ${STATUS_LABEL[st]}${etaText ? `, ${etaText}` : ''}${r.groupBlock ? ', wedding block' : ''}`}
    >
      <span className="num">
        {r.id}
        {r.groupBlock && <span className="grp" />}
      </span>
      <span className="st">{TILE_LABEL[st]}</span>
      {etaText && <span className="eta">{etaText}</span>}
      {rp && r.eta && st !== 'stayover' && (
        <span className="conf" title={`${r.eta.confidence} confidence`}>
          <i style={{ width: CONF_WIDTH[r.eta.confidence], background: CONF_COLOR[r.eta.confidence] }} />
        </span>
      )}
    </button>
  );
}

function RoomDetail({ s, r, onClose }: { s: SimState; r: Room; onClose: () => void }) {
  const toast = useToast();
  const [issue, setIssue] = useState(ISSUES[0]);
  const [busy, setBusy] = useState(false);
  const rp = s.mode === 'readypath';
  const st = visibleStatus(s, r);
  const guests = s.guests.filter((g) => g.roomId === r.id);
  const att = r.cleaningBy ? s.attendants.find((a) => a.id === r.cleaningBy) : undefined;
  const ticket = r.maintenanceTicket ? s.tickets.find((t) => t.id === r.maintenanceTicket) : undefined;

  const report = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/rooms/${r.id}/issue`, { issue });
      toast({ title: `Issue reported · ${r.id}`, body: res.message, tone: rp ? 'good' : 'neutral' });
    } catch (e) {
      toast({ title: 'Could not report issue', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card detail" aria-label={`Room ${r.id} details`}>
      <div className="card-head">
        <h2>
          Room {r.id} <span className="muted" style={{ fontWeight: 600 }}>· {r.type}</span>
        </h2>
        <button className="btn" onClick={onClose} aria-label="Close room details">✕</button>
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
            {st === 'ready' ? 'READY' : rp ? 'PREDICTED READY' : 'READINESS'}
          </div>
          {st === 'ready' ? (
            <div className="eta-big" style={{ color: 'var(--green)' }}>Ready{r.readyAt ? ` · ${fmtTime(r.readyAt)}` : ''}</div>
          ) : rp && r.eta ? (
            <>
              <div className="eta-big">{fmtRange(r.eta.low, r.eta.high)}</div>
              <span className={`pill ${r.eta.confidence === 'high' ? 'green' : r.eta.confidence === 'medium' ? 'amber' : 'red'}`}>{r.eta.confidence} confidence</span>
            </>
          ) : rp ? (
            <div className="eta-big" style={{ fontSize: 18 }}>{st === 'ooo' ? 'Out of order' : st === 'stayover' ? 'Stayover — no arrival' : 'Not scheduled'}</div>
          ) : (
            <div className="eta-big" style={{ fontSize: 18, color: 'var(--red)' }}>Unknown — phone housekeeping</div>
          )}
        </div>

        {rp && r.eta && (
          <div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>WHY THIS ESTIMATE</div>
            <ul className="why">
              {r.eta.drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        <dl>
          <dt>Status</dt>
          <dd>{STATUS_LABEL[st]}{!rp && st !== r.status ? <span className="muted"> (may be outdated)</span> : null}</dd>
          {rp && att && (
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
          {ticket && (
            <>
              <dt>Ticket</dt>
              <dd>{ticket.id} · {ticket.issue}</dd>
            </>
          )}
        </dl>

        <div>
          <div className="muted" style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>ARRIVING GUESTS</div>
          {guests.length === 0 ? (
            <div className="muted" style={{ fontSize: 14 }}>No arrival assigned.</div>
          ) : (
            guests.map((g) => <GuestLine key={g.code} s={s} g={g} />)
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <label htmlFor="issue" className="muted" style={{ fontSize: 13, fontWeight: 700 }}>REPORT A ROOM ISSUE</label>
          <div className="row" style={{ marginTop: 6 }}>
            <select id="issue" className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={issue} onChange={(e) => setIssue(e.target.value)}>
              {ISSUES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <button className="btn danger" disabled={busy || r.status === 'ooo'} onClick={report}>
              Report
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
            {rp ? 'Opens a maintenance ticket, moves the guest to the best available room and tells them who owns the fix.' : 'Today: the ticket goes to maintenance; the guest is not told.'}
          </p>
        </div>
      </div>
    </section>
  );
}

function GuestLine({ s, g }: { s: SimState; g: Guest }) {
  const notes = s.notifications.filter((n) => n.guestCode === g.code);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
      <div>
        <b>{g.name}</b> <span className="muted">· {g.partySize}p</span>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Arrives ~{fmtTime(g.arrivalTime)} · {g.consentSms ? `SMS ${g.phoneMasked}` : g.isDemoGuest ? 'Browser notifications' : 'Declined texts'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <GuestPill g={g} />
        <div>
          <a href={`/guest/${g.code}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            Guest view ↗
          </a>
        </div>
        {notes.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{notes.length} msg sent</div>}
      </div>
    </div>
  );
}

export function GuestPill({ g }: { g: Guest }) {
  const map = {
    expected: ['slate', 'Expected'],
    waiting: ['red', 'Waiting in lobby'],
    'informed-away': ['violet', 'Informed · away'],
    'checked-in': ['green', 'Checked in'],
  } as const;
  const [c, t] = map[g.state];
  return <span className={`pill ${c}`}>{t}</span>;
}

function Arrivals({ s, onPick }: { s: SimState; onPick: (id: string) => void }) {
  const rp = s.mode === 'readypath';
  const list = useMemo(
    () =>
      s.guests
        .filter((g) => !g.isDemoGuest && g.state !== 'checked-in')
        .sort((a, b) => (a.state === 'waiting' ? -1 : 0) - (b.state === 'waiting' ? -1 : 0) || a.arrivalTime - b.arrivalTime),
    [s.guests],
  );
  const desk = s.deskAgents;
  return (
    <>
      <section className="card" aria-label="Front desk agents">
        <div className="card-head">
          <h2>Desk agents</h2>
        </div>
        <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {desk.map((d, i) => (
            <div key={d.id} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
              <b>Agent {i + 1}</b>
              <span className={`pill ${d.task.startsWith('Calling') ? 'red' : d.task === 'Available' ? 'slate' : 'teal'}`}>{s.now < d.busyUntil ? d.task : 'Available'}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card" aria-label="Arrivals">
        <div className="card-head">
          <h2>Arrivals not yet in rooms</h2>
          <span className="mono muted">{list.length}</span>
        </div>
        {list.length === 0 ? (
          <div className="empty">Everyone is in their room.</div>
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
                    <button className="btn" style={{ padding: '2px 8px', fontSize: 12.5 }} onClick={() => onPick(r.id)}>
                      Room {r.id}
                    </button>
                    <span>~{fmtTime(g.arrivalTime)}</span>
                    {vis === 'ready' ? (
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>Room ready</span>
                    ) : rp && r.eta ? (
                      <span className="mono">{fmtRange(r.eta.low, r.eta.high)}</span>
                    ) : (
                      <span className="muted">ETA unknown</span>
                    )}
                    {rp && (sent ? <span className="pill teal">Notified</span> : !g.consentSms ? <span className="pill slate">No texts</span> : null)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
