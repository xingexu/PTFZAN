import { useState } from 'react';
import type { PlanProposal, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { api, useSim, useToast } from '../api';

export default function Supervisor() {
  const { state } = useSim();
  if (!state) return null;
  const rp = state.mode === 'readypath';
  const pending = state.proposals.find((p) => p.status === 'pending');
  const history = state.proposals.filter((p) => p.status !== 'pending' && p.trigger !== 'Routine refresh').slice(0, 12);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Housekeeping supervisor</h1>
          <p>
            {rp
              ? 'ReadyPath proposes; you decide. Routine changes apply automatically. Changes that affect guest promises wait for your approval.'
              : 'Today: the supervisor rebuilds assignments by hand and relays changes by phone or in person.'}
          </p>
        </div>
        {rp && <AutoApprove s={state} />}
      </div>

      <div className="grid sup">
        <div className="grid">
          {rp && (pending ? <ProposalCard p={pending} s={state} /> : <NoPending s={state} />)}
          <section className="card" aria-label="Attendant queues">
            <div className="card-head">
              <h2>Attendant queues</h2>
              <span className="muted" style={{ fontSize: 13 }}>Room-level only · no individual speed tracking</span>
            </div>
            <div className="queues">
              {state.attendants.map((a) => {
                const items = [...(a.currentRoom ? [a.currentRoom] : []), ...a.queue];
                return (
                  <div key={a.id} className={`queue ${a.present ? '' : 'absent'}`}>
                    <h4>
                      {a.label}
                      {!a.present ? <span className="pill red">Absent</span> : <span className="mono muted" style={{ fontSize: 12 }}>{items.length} rooms</span>}
                    </h4>
                    <div className="act">{a.activity}</div>
                    {items.slice(0, 9).map((id, i) => {
                      const r = state.rooms.find((x) => x.id === id)!;
                      return (
                        <div key={id} className={`qitem ${i === 0 && a.currentRoom ? 'now' : ''}`}>
                          <span>
                            {id} {r.groupBlock && <span className="dot" style={{ background: 'var(--violet)', marginLeft: 3 }} />}
                          </span>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {i === 0 && a.currentRoom ? 'now' : r.status === 'occupied' ? 'guest in' : r.status === 'stayover' ? 'stayover' : r.type === 'Double Queen' ? 'DQ' : r.type}
                          </span>
                        </div>
                      );
                    })}
                    {items.length > 9 && <div className="muted" style={{ fontSize: 12 }}>+{items.length - 9} more</div>}
                    {a.present && items.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nothing assigned</div>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="side">
          <section className="card" aria-label="Maintenance tickets">
            <div className="card-head">
              <h2>Maintenance</h2>
              <span className="mono muted">{state.tickets.filter((t) => t.status === 'open').length} open</span>
            </div>
            {state.tickets.length === 0 ? (
              <div className="empty">No open tickets.</div>
            ) : (
              <ul className="history">
                {state.tickets.map((t) => (
                  <li key={t.id}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b>{t.id} · {t.asset}</b>
                      <span className="pill red">{t.status}</span>
                    </div>
                    <div>{t.issue}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Opened {fmtTime(t.openedAt)} · {t.owner}
                      {rp ? ` · ${t.impact}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {rp && (
            <section className="card" aria-label="Decision history">
              <div className="card-head">
                <h2>Decision history</h2>
              </div>
              {history.length === 0 ? (
                <div className="empty">No plan changes yet.</div>
              ) : (
                <ul className="history">
                  {history.map((p) => (
                    <li key={p.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>{p.trigger}</b>
                        <span className={`pill ${p.status === 'approved' ? 'green' : p.status === 'dismissed' ? 'slate' : 'teal'}`}>{p.status}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
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

function AutoApprove({ s }: { s: SimState }) {
  const toast = useToast();
  return (
    <label className="row" style={{ fontWeight: 700, fontSize: 14, gap: 8 }}>
      <input
        type="checkbox"
        checked={s.autoApprove}
        onChange={(e) => api('/api/sim/auto-approve', { value: e.target.checked }).catch((err) => toast({ title: 'Error', body: (err as Error).message, tone: 'bad' }))}
      />
      Auto-approve everything (unattended demo)
    </label>
  );
}

function NoPending({ s }: { s: SimState }) {
  const last = s.proposals.find((p) => p.status !== 'pending');
  return (
    <section className="card card-pad">
      <h2>No decision needed right now</h2>
      <p className="muted" style={{ margin: '6px 0 0' }}>
        {last ? `Last change: "${last.trigger}" at ${fmtTime(last.createdAt)} (${last.status}).` : 'ReadyPath is monitoring room status, checkouts, absences and maintenance.'}
      </p>
    </section>
  );
}

function ProposalCard({ p, s }: { p: PlanProposal; s: SimState }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (kind: 'approve' | 'dismiss') => {
    setBusy(true);
    try {
      await api(`/api/proposals/${p.id}/${kind}`, {});
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
      <div className="card-head" style={{ background: 'var(--teal-soft)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <div>
          <span className="pill teal">Needs approval · {fmtTime(p.createdAt)}</span>
          <h2 style={{ marginTop: 6 }}>{p.trigger}</h2>
          <div className="muted" style={{ fontSize: 14 }}>{p.summary}</div>
        </div>
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={() => act('dismiss')}>Keep current plan</button>
          <button className="btn primary lg" disabled={busy} onClick={() => act('approve')}>Approve & notify guests</button>
        </div>
      </div>
      <div className="card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
        <b>Predicted impact:</b> <span>{p.impact}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          · {s.guests.filter((g) => g.group && g.consentSms).length} wedding guests will get an ETA by text on approval
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
                  <b>{c.roomId}</b> {r?.groupBlock && <span className="dot" style={{ background: 'var(--violet)', marginLeft: 3 }} />}
                </td>
                <td className="muted">{c.from}</td>
                <td>{c.to}</td>
                <td>{c.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.changes.length > 10 && <div className="muted" style={{ padding: '8px 18px 14px', fontSize: 13 }}>+{p.changes.length - 10} smaller changes</div>}
    </section>
  );
}
