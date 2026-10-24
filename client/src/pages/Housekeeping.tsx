import { useState } from 'react';
import { fmtTime } from '../../../shared/types';
import { api, useSim, useToast } from '../api';

export default function Housekeeping() {
  const { state } = useSim();
  const toast = useToast();
  const [who, setWho] = useState('A1');
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const rp = state.mode === 'readypath';
  const a = state.attendants.find((x) => x.id === who) ?? state.attendants[0];
  const current = a.currentRoom ? state.rooms.find((r) => r.id === a.currentRoom) : undefined;
  const next = a.queue.map((id) => state.rooms.find((r) => r.id === id)!).filter(Boolean).slice(0, 5);

  const report = async (roomId: string, issue: string) => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/rooms/${roomId}/issue`, { issue });
      toast({ title: `Reported ${issue.toLowerCase()} · ${roomId}`, body: res.message, tone: 'good' });
    } catch (e) {
      toast({ title: 'Could not report', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Room attendant phone</h1>
          <p>What an attendant sees. One tap per room status — the only data ReadyPath collects from housekeeping.</p>
        </div>
        <div className="seg" style={{ background: 'var(--slate-soft)' }} role="tablist" aria-label="Attendant">
          {state.attendants.map((x) => (
            <button key={x.id} role="tab" aria-selected={who === x.id} className={who === x.id ? 'on' : ''} style={{ color: who === x.id ? undefined : 'var(--ink-2)' }} onClick={() => setWho(x.id)}>
              {x.label.replace('Attendant ', 'A')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid hk">
        <div className="phone" aria-label={`${a.label}'s phone`}>
          <div className="phone-screen">
            <div className="phone-top" style={{ background: rp ? 'var(--teal)' : '#6b5a52' }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{fmtTime(state.now)} · {rp ? 'ReadyPath' : 'Paper assignment sheet'}</div>
              <h3>{a.label}</h3>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{a.present ? a.activity : 'Absent today'}</div>
            </div>
            <div className="phone-body">
              {!a.present ? (
                <div className="empty">Off sick. {rp ? 'Rooms were redistributed automatically at 8:00 AM.' : 'Rooms reassigned by hand at 8:50 AM.'}</div>
              ) : (
                <>
                  {current && (
                    <div className="task current">
                      <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>NOW</div>
                      <div className="r">Room {current.id}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {current.type} · {current.serviceKind === 'stayover' ? 'Stayover service' : 'Full clean'}
                        {current.groupBlock ? ' · Wedding block' : ''}
                      </div>
                      <div className="row wrap" style={{ marginTop: 10 }}>
                        <button className="btn danger" disabled={busy} onClick={() => report(current.id, 'AC not cooling')}>AC issue</button>
                        <button className="btn danger" disabled={busy} onClick={() => report(current.id, 'Plumbing leak')}>Leak</button>
                      </div>
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{rp ? 'UP NEXT · ORDER UPDATES LIVE' : 'YOUR LIST (IN ROOM ORDER)'}</div>
                  {next.length === 0 && <div className="task muted">{rp ? 'All done — the supervisor may send you to help.' : 'List complete.'}</div>}
                  {next.map((r, i) => (
                    <div className="task" key={r.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b style={{ fontSize: 17 }}>
                          {i + 1}. Room {r.id}
                        </b>
                        {r.groupBlock && <span className="pill violet">Wedding</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {r.type} ·{' '}
                        {rp
                          ? r.status === 'occupied'
                            ? `Guest leaves ~${fmtTime(r.lateReported && r.actualCheckout ? r.actualCheckout : r.scheduledCheckout ?? state.now)} — skip for now`
                            : r.status === 'stayover'
                              ? 'Stayover service'
                              : 'Vacant — ready to clean'
                          : 'Status unknown until you knock'}
                      </div>
                    </div>
                  ))}
                  <div className="privacy-note" style={{ marginTop: 'auto' }}>
                    <span aria-hidden="true">🔒</span>
                    <span>ReadyPath measures rooms, not people. No location tracking, no personal speed scores, no leaderboards.</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid">
          <section className="card card-pad">
            <h2>What changes for attendants</h2>
            <div className="compare" style={{ marginTop: 12 }}>
              <div className="col b">
                <h4>Today</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  <li>Paper list in room-number order, fixed at 8:00 AM</li>
                  <li>Knock on rooms that are still occupied — {state.mode === 'baseline' ? state.metrics.wastedVisits : 'many'} wasted visits so far</li>
                  <li>Priority changes arrive by phone, after cleaning starts</li>
                  <li>Maintenance issues reported twice</li>
                </ul>
              </div>
              <div className="col r">
                <h4>With ReadyPath</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  <li>Next room is always one that is actually vacant</li>
                  <li>Route updates instantly when plans change</li>
                  <li>Fewer floor changes when an elevator is down</li>
                  <li>One tap opens a ticket and re-rooms the guest</li>
                </ul>
              </div>
            </div>
          </section>
          <section className="card card-pad">
            <h2>Designed with the union, not around it</h2>
            <ul className="why">
              <li>Data is captured per room event (start, done, issue) — never per person speed.</li>
              <li>Historical averages are by room type and condition; individual performance is not stored.</li>
              <li>No GPS, beacons, cameras or wearables.</li>
              <li>Union representatives sit on the pilot steering group and review the data dictionary.</li>
              <li>Recovered time is redeployed to deep-clean and guest requests — not cut from schedules.</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
