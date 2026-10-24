import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { SimState } from '../../shared/types';
import { fmtTime } from '../../shared/types';
import { SimContext, ToastContext, useToast, type Toast } from './api';
import { ActivityContext, useActivityFeed } from './hotel/activity';
import { hotel, onRemoteChange, useHotel, useHotelSync } from './hotel/host';
import { Icon, type IconName } from './components/Icon';
import { fade } from './components/fade';
import { useSlide } from './components/slide';
import { GUEST_TAB, guestUrl, hasServer, HOTEL_TAB, isGuestView, separateSites } from './links';
import Engineering, { EnergyPage } from './pages/Engineering';
import Comparison from './pages/Comparison';
import FrontDesk from './pages/FrontDesk';
import GuestApp from './pages/guest/GuestApp';
import Welcome from './pages/guest/Welcome';
import Housekeeping from './pages/Housekeeping';
import Overview from './pages/Overview';
import Stage from './pages/Stage';
import StageRemote from './pages/StageRemote';
import Supervisor from './pages/Supervisor';
import { RequireAdmin, SignIn, SignOut } from './pages/AdminAccess';
import { GuestSignedOut } from './pages/guest/GuestAccess';

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
  // Guest screens show notifications at the top like a phone; the hotel view keeps them in a corner, clear of the controls.
  const guestScreen = isGuestView || useLocation().pathname.startsWith('/guest');

  return (
    <ToastContext.Provider value={push}>
      {isGuestView ? (
        // The guest view is its own site: only the hotel's app lives here.
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/stay" element={<GuestApp />} />
          <Route path="/logout" element={<GuestSignedOut />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          {separateSites ? (
            <Route path="/guest/*" element={<Away to={guestUrl('/')} />} />
          ) : (
            <>
              <Route path="/guest" element={<Welcome />} />
              <Route path="/guest/stay" element={<GuestApp />} />
              <Route path="/guest/logout" element={<GuestSignedOut />} />
              <Route path="/guest/*" element={<Navigate to="/guest" replace />} />
            </>
          )}
          <Route path="/login" element={<SignIn />} />
          <Route path="/logout" element={<SignOut />} />
          <Route element={<RequireAdmin />}>
          {hasServer && <Route path="/stage" element={<Stage />} />}
          {hasServer && <Route path="/stage/remote" element={<StageRemote />} />}
          <Route element={<HotelShell />}>
            <Route index element={<Overview />} />
            <Route path="front-desk" element={<FrontDesk />} />
            <Route path="supervisor" element={<Supervisor />} />
            <Route path="attendant" element={<Housekeeping />} />
            <Route path="engineering" element={<Engineering />} />
            <Route path="energy" element={<EnergyPage />} />
            <Route path="comparison" element={<Comparison />} />
            <Route path="housekeeping" element={<Navigate to="/attendant" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
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

/** Sends the browser to the other site (the guest app lives on its own site). */
function Away({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to]);
  return null;
}

const NAV: { to: string; label: string; icon: IconName; also?: string }[] = [
  { to: '/', label: 'Overview', icon: 'gauge' },
  { to: '/front-desk', label: 'Rooms', icon: 'bed' },
  { to: '/supervisor', label: 'Housekeeping', icon: 'users', also: '/attendant' },
  { to: '/engineering', label: 'Maintenance', icon: 'wrench' },
  { to: '/energy', label: 'Energy', icon: 'leaf' },
];

function HotelShell() {
  const state = useHotel();
  const sync = useHotelSync();
  const toast = useToast();
  const activity = useActivityFeed();
  const { pathname } = useLocation();
  const navRef = useSlide<HTMLElement>(pathname);
  const pending = state.proposals.some((p) => p.status === 'pending');
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [pathname]);
  const current = NAV.find((n) => n.to === pathname || n.also === pathname)?.label ?? 'Compare the day';

  // Changes made on another hotel screen show up here too, with a short note saying so.
  useEffect(() => onRemoteChange((title) => toast({ title, body: 'Every hotel screen follows the same day.' })), [toast]);

  useEffect(() => {
    document.title = 'Founders Hotel Network · Operations';
    document.body.classList.add('hq-body');
    return () => document.body.classList.remove('hq-body');
  }, []);

  return (
    <SimContext.Provider value={{ state, conn: sync.status === 'offline' ? 'reconnecting' : sync.status }}>
      <ActivityContext.Provider value={activity}>
        <div className={`shell hq ${state.mode === 'baseline' ? 'mode-today' : 'mode-ai'}`}>
          <div className="backdrop" aria-hidden="true" />
          <a className="skip-nav" href="#hotel-content">Skip to content</a>
          <aside className="hq-rail glass" aria-label="Hotel workspace">
            <NavLink to="/" className="rail-brand" aria-label="Founders Hotel Network · hotel view home" viewTransition>
              <span>Founders Hotel<br />Network</span>
            </NavLink>
            <div className="rail-property"><span className="rail-property-icon"><Icon name="building" size={19} /></span><div><b>Toronto Downtown</b><span>48 rooms · Floors 3–6</span></div></div>
            <span className="rail-label">WORKSPACE</span>
            <nav className="hq-nav slide" aria-label="Screens" ref={navRef}>
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} viewTransition title={n.label} aria-label={n.label} className={({ isActive }) => (isActive || pathname === n.also ? 'active' : '')}>
                  <Icon name={n.icon} size={18} /><span>{n.label}</span>
                  {n.to === '/supervisor' && pending && <span className="badge" aria-label="decision needed" />}
                </NavLink>
              ))}
            </nav>
            <div className="rail-bottom">
              <NavLink className="rail-guest" to="/comparison"><span><Icon name="gauge" size={17} />Compare the day</span><Icon name="right" size={14} /></NavLink>
              <a className="rail-guest" href={guestUrl('/')} target={GUEST_TAB}><span><Icon name="phoneDevice" size={17} />Guest app</span><Icon name="external" size={14} /></a>
              {hasServer && <NavLink className="rail-guest" to="/stage"><span><Icon name="monitor" size={17} />Message demo</span><Icon name="right" size={14} /></NavLink>}
              <div className="rail-footer"><span className="rail-avatar"><Icon name="shield" size={17} /></span><div><b>Hotel operations</b><span>Pitch the Future · 2026</span></div></div>
            </div>
          </aside>
          <header className="hq-top">
            <div className="hq-bar glass">
              <NavLink to="/" className="hq-mobile-brand" aria-label="Founders Hotel Network home">Founders<br />Hotel Network</NavLink>
              <div className="hq-breadcrumb"><span>Operations</span><Icon name="right" size={13} /><b>{current}</b></div>
              <div className="hq-actions">
                <NavLink className="hq-compare" to="/comparison">Compare</NavLink>
                <NavLink className="hq-signout" to="/logout"><Icon name="logout" size={16} /><span>Log out</span></NavLink>
              </div>
            </div>
          </header>
          <div id="hotel-content" className="hotel-content" tabIndex={-1}><Outlet /></div>
          {pathname !== '/' && pathname !== '/supervisor' && <DecisionCard state={state} />}
          <Player state={state} />
        </div>
      </ActivityContext.Provider>
    </SimContext.Provider>
  );
}

/** Actions that change the whole screen (a new day, a different mode) cross-fade instead of jumping. */
const SCREEN_CHANGES = new Set(['reset', 'demo', 'next-event']);

/** Runs a hotel control, surfacing failures as a toast. */
function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const call = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        let done: Promise<unknown> = Promise.resolve();
        if (SCREEN_CHANGES.has(action)) fade(() => (done = hotel(action, body)));
        else done = hotel(action, body);
        await done;
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

/** The day as a film: mode, playback, the day's moments on a scrubber, and the clock. */
function Player({ state }: { state: SimState }) {
  const modeRef = useSlide<HTMLDivElement>(state.mode);
  const { busy, call } = useAction();
  const pending = state.proposals.some((p) => p.status === 'pending');
  const auto = state.autopilot;
  const clock = fmtTime(state.now).split(' ');

  return (
    <footer className="player">
      <div className="seg mode slide" role="group" aria-label="How the hotel runs the day" ref={modeRef}>
        <button className={state.mode === 'baseline' ? 'on today-on' : ''} disabled={busy} onClick={() => call('reset', { mode: 'baseline' })} title="The previous method">
          Previous
        </button>
        <button className={state.mode === 'ai' ? 'on ai-on' : ''} disabled={busy} onClick={() => call('reset', { mode: 'ai' })} title="The new AI method">
          FHN AI
        </button>
      </div>
      <div className="pl-buttons">
        <button className="pl-btn" disabled={busy} onClick={() => call('reset', { mode: state.mode })} title="Start the day again" aria-label="Start again">
          <Icon name="reset" size={16} />
        </button>
        <button
          className="pl-btn main"
          disabled={busy || state.finished || pending}
          onClick={() => call('play', { playing: !state.playing })}
          aria-label={state.playing ? 'Pause' : 'Play'}
        >
          <Icon name={state.playing ? 'pause' : 'play'} size={18} />
        </button>
        <button className="pl-btn" disabled={busy || state.finished || pending} onClick={() => call('next-event')} title="Skip to the next moment" aria-label="Skip to next moment">
          <Icon name="skip" size={16} />
        </button>
      </div>
      <Scrubber state={state} />
      <div className="pl-clock" aria-label={fmtTime(state.now)}>
        {clock[0]}
        <small>{clock[1]}</small>
      </div>
      <button className={`pl-demo ${auto ? 'running' : ''}`} disabled={busy} onClick={() => (auto ? call('play', { playing: false }) : call('demo'))} title="The whole day with the new AI in about 30 seconds">
        <Icon name={auto ? 'pause' : state.finished ? 'reset' : 'play'} size={13} /> {auto ? 'Stop' : state.finished ? 'Play again' : '30-sec demo'}
      </button>
      <select className="pl-speed" aria-label="Playback speed" value={auto ? 'auto' : state.speed} onChange={(e) => call('speed', { speed: Number(e.target.value) })}>
        {auto && <option value="auto">Demo</option>}
        {SPEEDS.map(([s, label]) => (
          <option key={s} value={s}>
            {label}
          </option>
        ))}
      </select>
    </footer>
  );
}

function Scrubber({ state }: { state: SimState }) {
  const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - state.start) / (state.end - state.start)) * 100))}%`;
  return (
    <div className="scrubber" aria-label="The day, 8 AM to 5 PM">
      <div className="sc-track">
        <div className="sc-fill" style={{ width: pct(state.now) }} />
        {state.events.map((e, i) => (
          <span
            key={e.id}
            className={`sc-tick ${i < state.nextEventIndex ? 'done' : ''} ${i === state.nextEventIndex ? 'next' : ''}`}
            style={{ left: pct(e.at) }}
            title={`${fmtTime(e.at)} · ${e.title} — ${state.mode === 'ai' ? e.ai : e.today}`}
          />
        ))}
        <span className="sc-knob" style={{ left: pct(state.now) }} />
      </div>
      <div className="sc-ends" aria-hidden="true">
        <span>8 AM</span>
        <span>5 PM</span>
      </div>
    </div>
  );
}

/** A decision floats above the player while the supervisor's approval is needed. */
function DecisionCard({ state }: { state: SimState }) {
  const nav = useNavigate();
  const { busy, call } = useAction();
  const pending = state.proposals.find((p) => p.status === 'pending');
  if (pending) {
    return (
      <div className="decision" role="alert" key="pending">
        <span className="dc-ic">
          <Icon name="sparkles" size={16} />
        </span>
        <div className="dc-text">
          <span className="dc-k">Supervisor decides</span>
          <b>
            {pending.trigger} <span>· new cleaning order for {pending.changes.length} rooms</span>
          </b>
        </div>
        {state.autopilot ? (
          <span className="dc-hold" aria-label="Approving">
            <i />
          </span>
        ) : (
          <>
            <button className="btn sm" onClick={() => nav('/supervisor', { viewTransition: true })}>
              See plan
            </button>
            <button className="btn sm ai" disabled={busy} onClick={() => call('approve', { id: pending.id })}>
              <Icon name="check" size={14} /> Approve
            </button>
          </>
        )}
      </div>
    );
  }
  return null;
}

