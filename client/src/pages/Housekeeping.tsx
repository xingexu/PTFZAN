import { useState } from 'react';
import type { Attendant, SimState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { useSim, useToast } from '../api';
import { hotel } from '../hotel/host';
import { CompareBars } from '../components/Compare';
import { fade } from '../components/fade';
import { Icon } from '../components/Icon';
import { PageHead, TeamTabs } from '../components/PageHead';
import { sides } from '../components/rooms';

const away = (x: Attendant) => (x.onCall ? 'On call' : x.helper ? 'Back to own job' : 'Off sick');

export default function Housekeeping() {
  const { state } = useSim();
  const [who, setWho] = useState('A1');
  if (!state) return null;
  const a = state.attendants.find((x) => x.id === who) ?? state.attendants[0];

  return (
    <main className="page fit">
      <PageHead title="Housekeeping">
        <TeamTabs />
      </PageHead>

      <div className="grid att">
        <section className="card fill" aria-label="Attendants">
          <div className="card-head">
            <h2>Attendants</h2>
            <span className="sub">Tap one to see their phone</span>
          </div>
          <ul className="att-list card-scroll">
            {state.attendants.map((x) => {
              const left = (x.currentRoom ? 1 : 0) + x.queue.length;
              return (
                <li key={x.id}>
                  <button className={x.id === a.id ? 'on' : ''} aria-pressed={x.id === a.id} onClick={() => fade(() => setWho(x.id))}>
                    <span className="al-name">
                      <b>{x.label}</b>
                      <span>{x.present ? (x.currentRoom ? `Cleaning ${x.currentRoom}` : x.activity) : away(x)}</span>
                    </span>
                    <span className={`pill ${x.present ? 'slate' : x.onCall ? 'violet' : 'red'}`}>{x.present ? `${left} left` : away(x)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="att-phone">
          <AttendantPhone s={state} a={a} />
        </div>

        <section className="card fill" aria-label="What changes for attendants">
          <div className="card-head">
            <h2>On the floor today</h2>
          </div>
          <FloorStats s={state} />
        </section>
      </div>
    </main>
  );
}

function AttendantPhone({ s, a }: { s: SimState; a: Attendant }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ai = s.mode === 'ai';
  const current = a.currentRoom ? s.rooms.find((r) => r.id === a.currentRoom) : undefined;
  const next = a.queue.map((id) => s.rooms.find((r) => r.id === id)!).filter(Boolean).slice(0, 5);

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
    <div className="phone" aria-label={`${a.label}'s phone`}>
      <div className="phone-screen">
        <div className={`phone-top ${ai ? '' : 'today'}`}>
          <div className="pt-k">
            {fmtTime(s.now)} · {ai ? 'New AI' : 'Previous method'}
          </div>
          <h3>{a.label}</h3>
          <div className="pt-sub">{a.present ? a.activity : 'Absent today'}</div>
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
                    <b style={{ fontSize: 15 }}>
                      {i + 1}. Room {r.id}
                    </b>
                    {r.groupBlock && <span className="pill violet">Wedding</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {r.type} ·{' '}
                    {ai
                      ? r.status === 'occupied'
                        ? `Guest leaves ~${fmtTime(r.lateReported && r.actualCheckout ? r.actualCheckout : r.scheduledCheckout ?? s.now)} — skip for now`
                        : r.status === 'stayover'
                          ? 'Quick tidy (guest staying)'
                          : 'Empty — ready to clean'
                      : 'Status unknown until you knock'}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** What changes for attendants, today's way vs FHN AI. */
function FloorStats({ s }: { s: SimState }) {
  const { ai, today } = sides(s);
  return (
    <div className="floor-stats card-scroll">
      <div className="fs">
        <span className="fs-label">Knocks on rooms with a guest still inside</span>
        <CompareBars today={today?.wastedVisits} ai={ai?.wastedVisits} />
      </div>
      <div className="fs">
        <span className="fs-label">Time lost to those knocks</span>
        <CompareBars today={today?.attendantMinLost} ai={ai?.attendantMinLost} unit="min" />
      </div>
      <div className="fs">
        <span className="fs-label">Other staff pulled in to finish rooms</span>
        <CompareBars today={today?.pulledStaffMin} ai={ai?.pulledStaffMin} unit="min" />
      </div>
      <div className="privacy-note">
        <Icon name="shield" size={16} />
        <span>Rooms, not people — no tracking, no speed scores.</span>
      </div>
    </div>
  );
}
