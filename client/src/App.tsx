import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import type { SimState } from '../../shared/types';
import { fmtTime } from '../../shared/types';
import { api, SimContext, ToastContext, useEventStream, useSim, useToast, type Toast } from './api';
import { Logo } from './components/Logo';
import FrontDesk from './pages/FrontDesk';
import GuestPortal from './pages/GuestPortal';
import Housekeeping from './pages/Housekeeping';
import HowItWorks from './pages/HowItWorks';
import Join from './pages/Join';
import Overview from './pages/Overview';
import Stage from './pages/Stage';
import StageRemote from './pages/StageRemote';
import Supervisor from './pages/Supervisor';

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 5200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <Routes>
        <Route path="/guest/:code" element={<GuestPortal />} />
        <Route path="/join" element={<Join />} />
        <Route path="/stage" element={<Stage />} />
        <Route path="/stage/remote" element={<StageRemote />} />
        <Route element={<StaffShell />}>
          <Route index element={<Overview />} />
          <Route path="front-desk" element={<FrontDesk />} />
          <Route path="supervisor" element={<Supervisor />} />
          <Route path="housekeeping" element={<Housekeeping />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <div>
              <b>{t.title}</b>
              {t.body && <span>{t.body}</span>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function StaffShell() {
  const { data: state, conn } = useEventStream<SimState>('/api/stream');
  const barRef = useRef<HTMLElement>(null);

  // Keep the sticky timeline right under the top bar, whatever height it wraps to.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <SimContext.Provider value={{ state, conn }}>
      <div className="shell">
        <header className="topbar" ref={barRef}>
          <NavLink to="/" className="brand" aria-label="ReadyPath home">
            <Logo className="brand-mark" />
            <div>
              <div className="brand-name">ReadyPath</div>
              <div className="brand-sub">FHN Toronto</div>
            </div>
          </NavLink>
          <nav className="nav" aria-label="Screens">
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/front-desk">Front desk</NavLink>
            <NavLink to="/supervisor">
              Supervisor{state?.proposals.some((p) => p.status === 'pending') ? ' •' : ''}
            </NavLink>
            <NavLink to="/housekeeping">Housekeeping</NavLink>
            <NavLink to="/how-it-works">How it works</NavLink>
            <NavLink to="/stage">Live demo</NavLink>
          </nav>
          <Controls />
        </header>
        {state && <Timeline state={state} />}
        {state && <Banners state={state} />}
        {!state ? (
          <div className="page">
            <div className="card empty">{conn === 'reconnecting' ? 'Reconnecting to the ReadyPath server…' : 'Loading the October 16 shift…'}</div>
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </SimContext.Provider>
  );
}

function Controls() {
  const { state, conn } = useSim();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const call = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      await api(path, body);
    } catch (e) {
      toast({ title: 'Action not available', body: (e as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  if (!state) return <div className="controls" />;
  const pending = state.proposals.some((p) => p.status === 'pending');

  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="Scenario mode">
        <button className={state.mode === 'baseline' ? 'on' : ''} disabled={busy} onClick={() => call('/api/sim/reset', { mode: 'baseline' })} title="Replay Oct 16 with today's process">
          Today
        </button>
        <button className={state.mode === 'readypath' ? 'on rp' : ''} disabled={busy} onClick={() => call('/api/sim/reset', { mode: 'readypath' })} title="Replay Oct 16 with ReadyPath">
          With ReadyPath
        </button>
      </div>
      <div className="clock" aria-live="off" title={conn === 'live' ? 'Live' : 'Reconnecting'}>
        {fmtTime(state.now)}
      </div>
      <button
        className="iconbtn primary"
        disabled={busy || state.finished || pending}
        onClick={() => call('/api/sim/play', { playing: !state.playing })}
        aria-label={state.playing ? 'Pause' : 'Play'}
      >
        {state.playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <select className="speed" aria-label="Playback speed" value={state.speed} onChange={(e) => call('/api/sim/speed', { speed: Number(e.target.value) })}>
        {[1, 2, 5, 10, 20, 40].map((s) => (
          <option key={s} value={s}>
            {s} min/s
          </option>
        ))}
      </select>
      <button className="iconbtn" disabled={busy || state.finished || pending} onClick={() => call('/api/sim/next-event')} title="Jump to the next event">
        ⏭ Next event
      </button>
      <button className="iconbtn" disabled={busy} onClick={() => call('/api/sim/reset', { mode: state.mode })} title="Restart the shift at 8:00 AM">
        ↺
      </button>
    </div>
  );
}

function Timeline({ state }: { state: SimState }) {
  const span = state.end - state.start;
  const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - state.start) / span) * 100))}%`;
  return (
    <div className="timeline" aria-label="Shift timeline">
      <div className="tl-track">
        <div className="tl-fill" style={{ width: pct(state.now) }} />
        {state.events.map((e, i) => (
          <div
            key={e.id}
            className={`tl-ev ${i < state.nextEventIndex ? 'done' : ''} ${i === state.nextEventIndex ? 'next' : ''} ${i % 2 ? 'below' : ''} ${i === 0 ? 'first' : ''}`}
            style={{ left: pct(e.at) }}
            title={`${fmtTime(e.at)} — ${e.detail}`}
          >
            <span className="tl-dot" />
            <span className="tl-label">
              {fmtTime(e.at).replace(':00', '')} · {e.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Banners({ state }: { state: SimState }) {
  const nav = useNavigate();
  const pending = state.proposals.find((p) => p.status === 'pending');
  if (pending) {
    return (
      <div className="banner warn" role="alert">
        <span className="grow">
          ⏸ Paused at {fmtTime(state.now)} — <b>{pending.trigger}</b>: ReadyPath proposes re-sequencing {pending.changes.length} rooms. A supervisor must approve.
        </span>
        <button className="btn primary" onClick={() => nav('/supervisor')}>
          Review plan
        </button>
      </div>
    );
  }
  if (state.finished) {
    return (
      <div className={`banner ${state.mode === 'baseline' ? 'base' : 'info'}`}>
        <span className="grow">Shift complete. Switch modes above to compare the same day {state.mode === 'baseline' ? 'with ReadyPath' : 'without ReadyPath'}.</span>
      </div>
    );
  }
  if (state.mode === 'baseline') {
    return (
      <div className="banner base">
        <span className="grow">
          <b>Today&rsquo;s process:</b> paper assignments, phone calls, no shared readiness estimate. Same events, same staff.
        </span>
      </div>
    );
  }
  return null;
}
