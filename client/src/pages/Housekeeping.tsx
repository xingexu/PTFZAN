import { useState } from 'react';
import { fmtTime } from '../../../shared/types';
import { useSim, useToast } from '../api';
import { hotel } from '../hotel/host';
import { Icon } from '../components/Icon';
import { PageHead, TeamTabs } from '../components/PageHead';

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
      const res = await hotel('issue', { roomId, issue });
      toast({ title: `Reported ${issue.toLowerCase()} · ${roomId}`, body: res.message, tone: 'good' });
    } catch (e) {
      toast({ title: 'Could not report', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <PageHead title="Team">
        <TeamTabs />
      </PageHead>

      <div className="attendant-stage">
        <label className="att-pick">
          <span className="sr-only">Attendant</span>
          <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            {state.attendants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.present ? '' : x.onCall ? ' · on call' : x.helper ? ' · back to own job' : ' · off sick'}
              </option>
            ))}
          </select>
        </label>
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
                    <span>Rooms, not people — no tracking, no speed scores.</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
