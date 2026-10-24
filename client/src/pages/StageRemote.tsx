import { useCallback, useEffect, useRef, useState } from 'react';
import type { StageState } from '../../../shared/types';
import { fmtTime } from '../../../shared/types';
import { ApiError, setStagePin, stageApi, useEventStream, useToast } from '../api';
import { Logo } from '../components/Logo';
import { latestFor, PinDialog } from '../components/stageShared';

/** Phone remote for a teammate: one big button for the next step of the live demo. */
export default function StageRemote() {
  const { data: s, conn } = useEventStream<StageState>('/api/stage/stream');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [needPin, setNeedPin] = useState(false);
  const pending = useRef<null | (() => Promise<unknown>)>(null);

  useEffect(() => {
    document.title = 'Stage remote · ReadyPath';
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        if ('vibrate' in navigator) navigator.vibrate(40);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          pending.current = fn;
          setNeedPin(true);
        } else toast({ title: 'Not sent', body: (e as Error).message, tone: 'bad' });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  if (!s) {
    return (
      <div className="remote">
        <div className="muted">{conn === 'reconnecting' ? 'Reconnecting…' : 'Loading…'}</div>
      </div>
    );
  }

  const rec = latestFor(s, 'ready') ?? latestFor(s, 'eta');
  const label = s.step === 'booked' ? `Check ${s.name} in` : s.step === 'checked-in' ? `Room ${s.roomId} ready` : 'Done';
  const sub = s.step === 'booked' ? 'Sends the ETA text' : s.step === 'checked-in' ? `Sends the “room ready” text to ${s.name}` : 'Reset to run again';

  return (
    <div className="remote">
      <header className="remote-top">
        <Logo className="brand-mark" />
        <div>
          <div style={{ fontWeight: 800 }}>Stage remote</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {s.sendReal ? (s.messaging.provider === 'simulated' ? 'Simulated messages' : `Live · ${s.messaging.provider}`) : 'Rehearsal — nothing sent'}
          </div>
        </div>
      </header>

      <ol className="remote-steps" aria-label="Progress">
        {(['booked', 'checked-in', 'ready'] as const).map((st, i) => {
          const order = ['booked', 'checked-in', 'ready'];
          const done = order.indexOf(s.step) > i || (st === 'ready' && s.step === 'ready');
          return (
            <li key={st} className={`${done ? 'done' : ''} ${order.indexOf(s.step) === i && s.step !== 'ready' ? 'now' : ''}`}>
              {['Booked', 'Checked in', 'Ready'][i]}
            </li>
          );
        })}
      </ol>

      <button className={`remote-go ${s.step === 'ready' ? 'done' : ''}`} disabled={busy || s.step === 'ready'} onClick={() => run(() => stageApi('next'))}>
        <span className="remote-go-label">{label}</span>
        <span className="remote-go-sub">{sub}</span>
      </button>

      <div className="remote-status" aria-live="polite">
        {rec ? (
          <>
            <b>{rec.kind === 'ready' ? 'Ready text' : 'ETA text'}:</b>{' '}
            <span className={rec.status === 'failed' || rec.status === 'undelivered' ? 'bad' : ''}>{rec.status}</span>
            {rec.latencyMs !== undefined && <span className="muted"> · {(rec.latencyMs / 1000).toFixed(1)}s</span>}
            {rec.error && <div className="bad" style={{ fontSize: 13 }}>{rec.error}</div>}
          </>
        ) : (
          <span className="muted">
            {s.name} · room {s.roomId} · {s.phoneMasked ?? 'no phone set'} · {fmtTime(s.now)}
          </span>
        )}
      </div>

      <button className="btn block" disabled={busy} onClick={() => run(() => stageApi('reset'))}>
        ↺ Reset scene
      </button>

      {needPin && (
        <PinDialog
          onCancel={() => setNeedPin(false)}
          onSubmit={(pin) => {
            setStagePin(pin);
            setNeedPin(false);
            const fn = pending.current;
            pending.current = null;
            if (fn) run(fn);
          }}
        />
      )}
    </div>
  );
}
