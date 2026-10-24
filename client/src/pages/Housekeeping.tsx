import { useState } from 'react';
import { fmtTime } from '../../../shared/types';
import { api, useSim, useToast } from '../api';
import { Icon } from '../components/Icon';

export default function Housekeeping() {
  const { state } = useSim();
  const toast = useToast();
  const [who, setWho] = useState('A1');
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const ai = state.mode === 'ai';
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
          <p>What an attendant sees on their phone. One tap when a room is started, done, or has a problem — that’s all FHN AI collects.</p>
        </div>
        <div className="layer-seg" role="tablist" aria-label="Attendant">
          {state.attendants.map((x) => (
            <button key={x.id} role="tab" aria-selected={who === x.id} className={who === x.id ? 'on' : ''} onClick={() => setWho(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid hk">
        <div className="phone" aria-label={`${a.label}'s phone`}>
          <div className="phone-screen">
            <div className={`phone-top ${ai ? '' : 'today'}`}>
              <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>
                {fmtTime(state.now)} · {ai ? 'FHN AI' : 'Paper list'}
              </div>
              <h3>{a.label}</h3>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{a.present ? a.activity : 'Absent today'}</div>
            </div>
            <div className="phone-body">
              {!a.present ? (
                <div className="empty">
                  {a.onCall
                    ? ai
                      ? 'Booked at 8:00 AM from the forecast — starts at 8:45 AM.'
                      : 'On call, but nobody books them: without a forecast the shortfall isn’t visible until 3:45 PM.'
                    : a.helper
                      ? 'Pulled in at the 3:45 PM escalation; back to their own job now.'
                      : `Off sick. ${ai ? 'Rooms were redistributed automatically at 8:00 AM.' : 'Rooms reassigned by hand at 8:00 AM, added to the end of everyone’s list.'}`}
                </div>
              ) : (
                <>
                  {current && (
                    <div className="task current">
                      <div className="eyebrow">Now</div>
                      <div className="r">Room {current.id}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {current.type} · {current.serviceKind === 'stayover' ? 'Quick tidy (guest staying)' : 'Full clean'}
                        {current.groupBlock ? ' · Wedding block' : ''}
                      </div>
                      <div className="row wrap" style={{ marginTop: 10 }}>
                        <button className="btn danger sm" disabled={busy} onClick={() => report(current.id, 'AC not cooling')}>
                          <Icon name="snow" size={14} /> AC issue
                        </button>
                        <button className="btn danger sm" disabled={busy} onClick={() => report(current.id, 'Plumbing leak')}>
                          <Icon name="drop" size={14} /> Leak
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="eyebrow" style={{ marginTop: 4 }}>{ai ? 'Up next · order updates live' : 'Your list (in room order)'}</div>
                  {next.length === 0 && <div className="task muted">{ai ? 'All done — the supervisor may send you to help.' : 'List complete.'}</div>}
                  {next.map((r, i) => (
                    <div className="task" key={r.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b style={{ fontSize: 16 }}>
                          {i + 1}. Room {r.id}
                        </b>
                        {r.groupBlock && <span className="pill violet">Wedding</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        {r.type} ·{' '}
                        {ai
                          ? r.status === 'occupied'
                            ? `Guest leaves ~${fmtTime(r.lateReported && r.actualCheckout ? r.actualCheckout : r.scheduledCheckout ?? state.now)} — skip for now`
                            : r.status === 'stayover'
                              ? 'Quick tidy (guest staying)'
                              : 'Empty — ready to clean'
                          : 'Status unknown until you knock'}
                      </div>
                    </div>
                  ))}
                  <div className="privacy-note" style={{ marginTop: 'auto' }}>
                    <Icon name="shield" size={16} />
                    <span>FHN AI measures rooms, not people. No location tracking, no personal speed scores, no leaderboards.</span>
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
                <ul>
                  <li>Paper list in room-number order, fixed at 8:00 AM</li>
                  <li>Knock on rooms that are still occupied — {state.mode === 'baseline' ? `${state.metrics.wastedVisits} wasted visits (${state.metrics.attendantMinLost} min)` : 'dozens of wasted visits'} so far</li>
                  <li>Priority changes arrive by phone, after cleaning starts</li>
                  <li>Maintenance issues reported twice</li>
                </ul>
              </div>
              <div className="col r">
                <h4>With FHN AI</h4>
                <ul>
                  <li>Next room is always one that is actually empty</li>
                  <li>Route updates instantly when plans change</li>
                  <li>Fewer floor changes when an elevator is down</li>
                  <li>One tap reports a problem and moves the guest</li>
                  <li>Tomorrow&rsquo;s schedule is set from the forecast, not patched with overtime</li>
                </ul>
              </div>
            </div>
          </section>
          <section className="card card-pad">
            <h2>Designed with the union, not around it</h2>
            <ul className="why">
              <li>Only room events are recorded (started, done, problem) — never how fast a person works.</li>
              <li>Cleaning times are averaged by room type, never by person.</li>
              <li>No location tracking, cameras or wearables.</li>
              <li>Union representatives help run the pilot and approve the list of what is recorded.</li>
              <li>Time saved goes to deep cleans and guest requests — not cut from schedules.</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
