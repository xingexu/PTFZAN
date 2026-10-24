import { useState } from 'react';
import type { PlanProposal, SimState, StaffingForecast } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim, useToast } from '../api';
import { hotel } from '../hotel/host';
import { Icon } from '../components/Icon';
import { PageHead, TeamTabs } from '../components/PageHead';

const DECIDED: Record<PlanProposal['status'], string> = { pending: 'Waiting', approved: 'Approved', 'auto-applied': 'Automatic', dismissed: 'Kept old plan' };

export default function Supervisor() {
  const { state } = useSim();
  if (!state) return null;
  const ai = state.mode === 'ai';
  const pending = state.proposals.find((p) => p.status === 'pending');
  const history = state.proposals.filter((p) => p.status !== 'pending' && p.trigger !== 'Regular update').slice(0, 12);

  return (
    <main className="page fit">
      <PageHead title="Team">
        {ai && <AutoApprove s={state} />}
        <TeamTabs />
      </PageHead>

      <div className="grid sup">
        <div className="col">
          {ai && (pending ? <ProposalCard p={pending} s={state} /> : <NoPending s={state} />)}
          <section className="card fill" aria-label="Attendant queues">
            <div className="card-head">
              <h2>Attendant lists</h2>
              <span className="sub">Tracks rooms, never people</span>
            </div>
            <div className="queues card-scroll">
              {state.attendants.map((a) => {
                const items = [...(a.currentRoom ? [a.currentRoom] : []), ...a.queue];
                return (
                  <div key={a.id} className={`queue ${a.present ? '' : 'absent'}`}>
                    <h4>
                      {a.label}
                      {a.present ? (
                        <span className="pill slate">{items.length} rooms</span>
                      ) : a.onCall ? (
                        <span className="pill violet">On call</span>
                      ) : a.helper ? (
                        <span className="pill slate">Back to own job</span>
                      ) : (
                        <span className="pill red">Absent</span>
                      )}
                    </h4>
                    <div className="act">{a.activity}</div>
                    {items.slice(0, 9).map((id, i) => {
                      const r = state.rooms.find((x) => x.id === id)!;
                      return (
                        <div key={id} className={`qitem ${i === 0 && a.currentRoom ? 'now' : ''}`}>
                          <span className="row" style={{ gap: 5 }}>
                            {id} {r.groupBlock && <span className="dot" style={{ background: '#fff' }} />}
                          </span>
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {i === 0 && a.currentRoom ? 'now' : r.status === 'occupied' ? 'guest in' : r.status === 'stayover' ? 'staying' : r.type === 'Double Queen' ? 'Double' : r.type}
                          </span>
                        </div>
                      );
                    })}
                    {items.length > 9 && <div className="muted" style={{ fontSize: 12 }}>+{items.length - 9} more</div>}
                    {a.present && items.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Nothing assigned</div>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="col">
          <StaffingCard f={state.staffing} />
          {ai && (
            <section className="card fill" aria-label="Decision history">
              <div className="card-head">
                <h2>Decision history</h2>
              </div>
              {history.length === 0 ? (
                <div className="empty">No plan changes yet.</div>
              ) : (
                <ul className="history card-scroll">
                  {history.map((p) => (
                    <li key={p.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>{p.trigger}</b>
                        <span className={`pill ${p.status === 'approved' ? 'green' : p.status === 'dismissed' ? 'slate' : 'ai'}`}>{DECIDED[p.status]}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {fmtTime(p.createdAt)} · {p.changes.length} rooms · {p.impact}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

/** Labour: tomorrow's workload from reservations — staffed in advance instead of patched with overtime. */
function StaffingCard({ f }: { f: StaffingForecast }) {
  const max = Math.max(...f.blocks.map((b) => b.attendants), f.scheduled) + 1;
  return (
    <section className="card" aria-label="Tomorrow's staffing forecast">
      <div className="card-head">
        <div className="title">
          <Icon name="calendar" size={16} />
          <h2>Tomorrow · {f.date}</h2>
        </div>
        <span className="ai-chip">
          <Icon name="sparkles" size={12} /> Forecast
        </span>
      </div>
      <div className="card-pad">
        <div className="forecast-stats">
          <div className="fstat">
            <b>{f.workloadHours} h</b>
            <span>hours of cleaning</span>
          </div>
          <div className="fstat">
            <b>{f.departures}</b>
            <span>departures</span>
          </div>
          <div className="fstat">
            <b>{f.stayovers}</b>
            <span>staying guests{f.greenChoice ? ` (−${f.greenChoice} skipping)` : ''}</span>
          </div>
        </div>
        <div className="blocks" aria-label="Attendants needed per block">
          {f.blocks.map((b) => (
            <div className="block" key={b.label}>
              <span>{b.label}</span>
              <span className="block-bar" title={`${b.load} h of work`}>
                <i style={{ width: `${(b.attendants / max) * 100}%` }} />
                <span className="cap" style={{ left: `${(f.scheduled / max) * 100}%` }} title={`${f.scheduled} scheduled`} />
              </span>
              <span className="num">{b.attendants} needed</span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11.5 }}>Line = {f.scheduled} scheduled</div>
        </div>
        <div className={`banner ${f.overtimeHours > 0 ? 'ai' : 'done'}`} style={{ borderRadius: 10, marginTop: 12, border: 0 }}>
          <span className="grow">
            <Icon name={f.overtimeHours > 0 ? 'users' : 'check'} size={15} />
            <span>
              {f.recommendation}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function AutoApprove({ s }: { s: SimState }) {
  const toast = useToast();
  return (
    <label className="row" style={{ fontWeight: 650, fontSize: 13.5, gap: 8 }}>
      <input
        type="checkbox"
        checked={s.autoApprove}
        onChange={(e) => hotel('auto-approve', { value: e.target.checked }).catch((err) => toast({ title: 'Error', body: (err as Error).message, tone: 'bad' }))}
      />
      Auto-approve
    </label>
  );
}

function NoPending({ s }: { s: SimState }) {
  const last = s.proposals.find((p) => p.status !== 'pending');
  return (
    <section className="card card-pad row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span className="pillar-icon tone-ai">
        <Icon name="check" size={16} />
      </span>
      <div>
        <h2>No decision needed right now</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {last ? `Last change: “${last.trigger}” at ${fmtTime(last.createdAt)} (${DECIDED[last.status].toLowerCase()}).` : 'FHN AI is watching room status, checkouts, absences and repairs.'}
        </p>
      </div>
    </section>
  );
}

function ProposalCard({ p, s }: { p: PlanProposal; s: SimState }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (kind: 'approve' | 'dismiss') => {
    setBusy(true);
    try {
      await hotel(kind, { id: p.id });
      toast(
        kind === 'approve'
          ? { title: 'Plan approved', body: 'Attendant phones updated. Guests are receiving realistic ETAs.', tone: 'good' }
          : { title: 'Current plan kept', body: 'No changes were sent.' },
      );
    } catch (e) {
      toast({ title: 'Could not update plan', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card proposal pending" aria-label="Plan awaiting approval">
      <div className="proposal-head">
        <div>
          <span className="ai-chip">
            <Icon name="sparkles" size={12} /> Your decision · {fmtTime(p.createdAt)}
          </span>
          <h2 style={{ marginTop: 8, fontSize: 18 }}>{p.trigger}</h2>
          <div className="muted" style={{ fontSize: 13.5 }}>{p.summary}</div>
        </div>
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={() => act('dismiss')}>
            Keep current plan
          </button>
          <button className="btn ai lg" disabled={busy} onClick={() => act('approve')}>
            <Icon name="check" size={16} /> Approve & notify guests
          </button>
        </div>
      </div>
      <div className="card-pad row wrap" style={{ borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
        <b>What changes:</b> <span>{p.impact}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          · {s.guests.filter((g) => g.group && g.consentSms).length} wedding guests get their ready time by text when you approve
        </span>
      </div>
      <table className="changes">
        <thead>
          <tr>
            <th>Room</th>
            <th>From</th>
            <th>To</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {p.changes.slice(0, 10).map((c) => {
            const r = s.rooms.find((x) => x.id === c.roomId);
            return (
              <tr key={c.roomId}>
                <td>
                  <b>{c.roomId}</b> {r?.groupBlock && <span className="dot" style={{ background: '#fff', marginLeft: 3 }} />}
                </td>
                <td className="muted">{c.from}</td>
                <td>{c.to}</td>
                <td>{c.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.changes.length > 10 && <div className="muted" style={{ padding: '8px 18px 14px', fontSize: 12.5 }}>+{p.changes.length - 10} smaller changes</div>}
    </section>
  );
}
