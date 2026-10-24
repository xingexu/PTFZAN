import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { LogEntry, ScenarioEvent, SimState } from '../../shared/types';
import { fmtTime } from '../../shared/types';
import { api, getBooking, SimContext, ToastContext, useEventStream, useSim, useToast, type Toast } from './api';
import { Icon } from './components/Icon';
import { Brand } from './components/Logo';
import { GUEST_TAB, guestUrl, HOTEL_TAB, isGuestView } from './links';
import Engineering from './pages/Engineering';
import FrontDesk from './pages/FrontDesk';
import GuestApp from './pages/guest/GuestApp';
import Onboarding from './pages/guest/Onboarding';
import Housekeeping from './pages/Housekeeping';
import Overview from './pages/Overview';
import Plan from './pages/Plan';
import Stage from './pages/Stage';
import StageRemote from './pages/StageRemote';
import Supervisor from './pages/Supervisor';

const TOAST_MS = 3800;
const TOAST_EXIT_MS = 200;

// Each view names its tab (so links from the other view can reuse it) and gets its own tab icon.
window.name = isGuestView ? GUEST_TAB : HOTEL_TAB;
if (isGuestView) document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', '/favicon-guest.svg');

type LiveToast = Toast & { leaving?: boolean };

export default function App() {
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.map((y) => (y.id === id ? { ...y, leaving: true } : y))), TOAST_MS - TOAST_EXIT_MS);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), TOAST_MS);
  }, []);
  const booking = getBooking();
  // Guest screens show notifications at the top like a phone; the hotel view keeps them in a corner, clear of the controls.
  const guestScreen = isGuestView || /^\/(guest|join)/.test(useLocation().pathname);

  return (
    <ToastContext.Provider value={push}>
      {isGuestView ? (
        // The guest view is its own site: only the hotel's app lives here.
        <Routes>
          <Route path="/guest/:code" element={<GuestApp />} />
          <Route path="/join" element={<Onboarding />} />
          <Route path="*" element={<Navigate to={booking ? `/guest/${booking}` : '/join'} replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/guest/:code" element={<GuestApp />} />
          <Route path="/join" element={<Onboarding />} />
          <Route path="/app" element={<Navigate to={booking ? `/guest/${booking}` : '/join'} replace />} />
          <Route path="/stage" element={<Stage />} />
          <Route path="/stage/remote" element={<StageRemote />} />
          <Route element={<HotelShell />}>
            <Route index element={<Overview />} />
            <Route path="front-desk" element={<FrontDesk />} />
            <Route path="supervisor" element={<Supervisor />} />
            <Route path="attendant" element={<Housekeeping />} />
            <Route path="engineering" element={<Engineering />} />
            <Route path="plan" element={<Plan />} />
            <Route path="housekeeping" element={<Navigate to="/attendant" replace />} />
            <Route path="how-it-works" element={<Navigate to="/plan" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      <div className={`toast-stack ${guestScreen ? 'top' : 'corner'}`} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''} ${t.fromGuest ? 'from-guest' : ''} ${t.leaving ? 'leaving' : ''}`}>
            <Icon name={t.fromGuest ? 'phoneDevice' : t.tone === 'bad' ? 'alert' : t.tone === 'good' ? 'check' : 'info'} size={17} />
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

const NAV: [string, string][] = [
  ['/', 'Overview'],
  ['/front-desk', 'Front desk'],
  ['/supervisor', 'Supervisor'],
  ['/attendant', 'Attendant'],
  ['/engineering', 'Repairs & energy'],
  ['/plan', 'The plan'],
];

function HotelShell() {
  const { data: state, conn } = useEventStream<SimState>('/api/stream');
  const pending = state?.proposals.some((p) => p.status === 'pending');
  useGuestActivity(state);

  useEffect(() => {
    document.title = 'Hotel view · Founders';
  }, []);

  return (
    <SimContext.Provider value={{ state, conn }}>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="brand" aria-label="Hotel view home" viewTransition>
              <Brand sub="Hotel view · Toronto Downtown" />
            </NavLink>
            <nav className="nav" aria-label="Screens">
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'} viewTransition>
                  {label}
                  {to === '/supervisor' && pending && <span className="badge" aria-label="decision needed" />}
                </NavLink>
              ))}
            </nav>
            <div className="top-actions">
              <a className="btn sm guest-link" href={guestUrl('/app')} target={GUEST_TAB} title="Open the guest app in its own tab">
                <Icon name="phoneDevice" size={15} />
                <span className="lbl">Guest view</span>
                {!!state?.guestsOnline && (
                  <span className="live-count" title={`${state.guestsOnline} guest app${state.guestsOnline === 1 ? '' : 's'} open right now`}>
                    {state.guestsOnline}
                  </span>
                )}
              </a>
              <Link className="btn sm" to="/stage" title="The live text-message moment for the pitch">
                <Icon name="monitor" size={15} /> <span className="lbl">Live text demo</span>
              </Link>
            </div>
          </div>
        </header>
        {state && <Transport state={state} />}
        {state && <Banners state={state} />}
        {!state ? <ShellSkeleton reconnecting={conn === 'reconnecting'} /> : <Outlet />}
      </div>
    </SimContext.Provider>
  );
}

/** When a guest does something in the guest app, the hotel sees it right away. */
function useGuestActivity(state: SimState | null) {
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);
  const log = state?.log;
  useEffect(() => {
    if (!log) return;
    const key = (l: LogEntry) => `${l.at}|${l.text}`;
    if (seen.current === null) {
      seen.current = new Set(log.map(key));
      return;
    }
    for (const l of [...log].reverse()) {
      const k = key(l);
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      if (l.fromApp) toast({ title: 'From the guest app', body: l.text, fromGuest: true });
    }
  }, [log, toast]);
}

function ShellSkeleton({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="page" aria-busy="true">
      <div className="skeleton" style={{ height: 22, width: 360, marginBottom: 14 }} />
      <div className="pillars">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card skeleton-card" />
        ))}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        {reconnecting ? 'Reconnecting to the hotel system…' : 'Loading Friday, October 16…'}
      </p>
    </div>
  );
}

/** Calls an API action, surfacing failures as a toast. */
function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const call = useCallback(
    async (path: string, body: unknown = {}) => {
      setBusy(true);
      try {
        await api(path, body);
      } catch (e) {
        toast({ title: 'That didn’t work', body: (e as Error).message, tone: 'bad' });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, call };
}

const SPEEDS: [number, string][] = [
  [5, 'Slow'],
  [10, 'Normal'],
  [20, 'Fast'],
  [30, 'Faster'],
  [60, 'Fastest'],
];

function Transport({ state }: { state: SimState }) {
  const { conn } = useSim();
  const { busy, call } = useAction();
  const pending = state.proposals.some((p) => p.status === 'pending');
  const auto = state.autopilot;

  return (
    <div className="transport">
      <div className="tp-controls">
        <div className="seg" role="group" aria-label="How the hotel runs the day">
          <button className={state.mode === 'baseline' ? 'on' : ''} disabled={busy} onClick={() => call('/api/sim/reset', { mode: 'baseline' })} title="Replay October 16 the way the hotel runs today">
            Today
          </button>
          <button className={state.mode === 'ai' ? 'on ai-on' : ''} disabled={busy} onClick={() => call('/api/sim/reset', { mode: 'ai' })} title="Replay October 16 with FHN AI">
            <Icon name="sparkles" size={14} /> FHN AI
          </button>
        </div>
        <button
          className={`tp-demo ${auto ? 'running' : ''}`}
          disabled={busy}
          onClick={() => (auto ? call('/api/sim/play', { playing: false }) : call('/api/sim/demo'))}
          title="Play the whole day with FHN AI in about 30 seconds"
        >
          <Icon name={auto ? 'pause' : 'play'} size={14} /> {auto ? 'Stop demo' : '30-sec demo'}
        </button>
        <button
          className="tp-btn play"
          disabled={busy || state.finished || pending}
          onClick={() => call('/api/sim/play', { playing: !state.playing })}
          aria-label={state.playing ? 'Pause' : 'Play'}
          title={state.playing ? 'Pause' : 'Play'}
        >
          <Icon name={state.playing ? 'pause' : 'play'} size={15} />
        </button>
        <button className="tp-btn" disabled={busy || state.finished || pending} onClick={() => call('/api/sim/next-event')} title="Skip to the next moment on the timeline" aria-label="Skip to next moment">
          <Icon name="skip" size={15} />
        </button>
        <button className="tp-btn" disabled={busy} onClick={() => call('/api/sim/reset', { mode: state.mode })} title="Start the day again at 8:00 AM" aria-label="Start again">
          <Icon name="reset" size={15} />
        </button>
        <select className="tp-speed" aria-label="Playback speed" value={auto ? 'auto' : state.speed} onChange={(e) => call('/api/sim/speed', { speed: Number(e.target.value) })}>
          {auto && <option value="auto">Demo speed</option>}
          {SPEEDS.map(([s, label]) => (
            <option key={s} value={s} title={`1 second = ${s} minutes of the day`}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Timeline state={state} />
      <div className="tp-clock" aria-live="off" title={conn === 'live' ? 'Live' : 'Reconnecting'}>
        {fmtTime(state.now)}
      </div>
    </div>
  );
}

const LABEL_FONT = '700 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
const LABEL_GAP = 10;

/**
 * Places each timeline label above or below the track, wherever it fits at the current width.
 * A label that can't fit in either row is left to its tooltip rather than overlapping a neighbour.
 */
function layoutLabels(events: ScenarioEvent[], start: number, end: number, width: number) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) ctx.font = LABEL_FONT;
  const lastEnd = [-Infinity, -Infinity];
  return events.map((e, i) => {
    const text = `${fmtTime(e.at).replace(/:00| (AM|PM)/g, '')} · ${e.title}`;
    const w = (ctx?.measureText(text).width ?? text.length * 6.2) + 2;
    const x = ((e.at - start) / (end - start)) * width;
    const align = i === 0 ? 'first' : e.at >= end ? 'last' : '';
    const from = align === 'first' ? x - 4 : align === 'last' ? x + 4 - w : x - w / 2;
    const preferred = i % 2;
    const row = [preferred, 1 - preferred].find((r) => from >= lastEnd[r] + LABEL_GAP);
    if (row !== undefined) lastEnd[row] = from + w;
    return { text, align, row: row ?? 0, hidden: row === undefined };
  });
}

function Timeline({ state }: { state: SimState }) {
  const span = state.end - state.start;
  const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - state.start) / span) * 100))}%`;
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const labels = useMemo(() => layoutLabels(state.events, state.start, state.end, width), [state.events, state.start, state.end, width]);
  return (
    <div className="timeline" aria-label="The day's timeline">
      <div className="tl-track" ref={track}>
        <div className={`tl-fill ${state.mode === 'ai' ? 'ai' : ''}`} style={{ width: pct(state.now) }} />
        {state.events.map((e, i) => (
          <div
            key={e.id}
            className={`tl-ev ${i < state.nextEventIndex ? 'done' : ''} ${i === state.nextEventIndex ? 'next' : ''} ${labels[i].row ? 'below' : ''} ${labels[i].align}`}
            style={{ left: pct(e.at) }}
            title={`${fmtTime(e.at)} — ${e.detail}`}
          >
            <span className="tl-dot" />
            {width > 0 && !labels[i].hidden && <span className="tl-label">{labels[i].text}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Banners({ state }: { state: SimState }) {
  const nav = useNavigate();
  const { busy, call } = useAction();
  const pending = state.proposals.find((p) => p.status === 'pending');
  const change = pending?.impact.split(': ')[1];

  if (pending && state.autopilot) {
    return (
      <div className="banner auto" role="status" key="hold">
        <span className="grow">
          <Icon name="sparkles" size={16} />
          <span>
            <b>{pending.trigger}</b> — FHN AI suggests a new cleaning order for {pending.changes.length} rooms{change ? ` (wedding rooms ready by 3 PM: ${change})` : ''}. Supervisor approving…
          </span>
        </span>
        <span className="hold-bar" aria-hidden="true">
          <i />
        </span>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="banner ai" role="alert" key="pending">
        <span className="grow">
          <Icon name="sparkles" size={16} />
          <span>
            Paused at {fmtTime(state.now)} — <b>{pending.trigger}</b>. FHN AI suggests a new cleaning order for {pending.changes.length} rooms; a supervisor decides.
          </span>
        </span>
        <button className="btn sm" onClick={() => nav('/supervisor', { viewTransition: true })}>
          See the plan
        </button>
        <button className="btn sm ai" disabled={busy} onClick={() => call(`/api/proposals/${pending.id}/approve`)}>
          <Icon name="check" size={14} /> Approve
        </button>
      </div>
    );
  }
  if (state.autopilot) {
    return (
      <div className="banner auto" key="auto">
        <span className="grow">
          <Icon name="play" size={13} />
          <span>
            <b>30-second demo</b> · the real October 16 shift record, with FHN AI on the right and today&rsquo;s way on the left.
          </span>
        </span>
      </div>
    );
  }
  if (state.finished) {
    return (
      <div className="banner done" key="done">
        <span className="grow">
          <Icon name="check" size={16} />
          <span>The day is over. Every number here is compared with the same day {state.mode === 'baseline' ? 'with FHN AI' : 'run today’s way'}.</span>
        </span>
        <button className="btn sm" disabled={busy} onClick={() => call('/api/sim/demo')}>
          <Icon name="reset" size={14} /> Play the demo again
        </button>
      </div>
    );
  }
  if (state.mode === 'baseline') {
    return (
      <div className="banner base" key="base">
        <span className="grow">
          <Icon name="phone" size={15} />
          <span>
            <b>Today&rsquo;s way:</b> paper lists, phone calls, and nobody can see when rooms will be ready. Same events, same staff.
          </span>
        </span>
      </div>
    );
  }
  return null;
}
