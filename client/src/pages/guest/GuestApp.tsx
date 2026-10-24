import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import type { GuestRequest, GuestView, HousekeepingPref, Hvac, RoomStatus } from '../../../../shared/types';
import { fmtRange, fmtTime } from '../../../../shared/types';
import { ToastContext, useToast, type Toast } from '../../api';
import { chime } from '../../components/chime';
import { Icon, type IconName } from '../../components/Icon';
import { Brand } from '../../components/Logo';
import { useSlide } from '../../components/slide';
import { useJourney } from '../../guest/journey';
import { guestPath, HOTEL_TAB, hotelUrl } from '../../links';
import { GuestFrame } from './GuestFrame';

type Tab = 'home' | 'key' | 'requests' | 'chat';
const TAB_ORDER: Tab[] = ['home', 'key', 'requests', 'chat'];
const SHEET_EXIT_MS = 180;

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void> } };

/** Switches screens with a short slide (view transitions where supported, a CSS fade otherwise). */
function withTransition(dir: 'fwd' | 'back', update: () => void) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  document.documentElement.dataset.vt = dir;
  const t = doc.startViewTransition(() => flushSync(update));
  // A skipped transition (e.g. the tab went to the background) still applies the update; nothing to report.
  t.ready.catch(() => undefined);
  t.finished.catch(() => undefined).finally(() => delete document.documentElement.dataset.vt);
}
type Sheet = 'climate' | 'housekeeping' | 'issue' | 'items' | 'wifi';

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
const ISSUES: { label: string; icon: IconName }[] = [
  { label: 'AC not cooling', icon: 'snow' },
  { label: 'Room too cold', icon: 'flame' },
  { label: 'Plumbing leak', icon: 'drop' },
  { label: 'TV not working', icon: 'tv' },
  { label: 'Wi-Fi not working', icon: 'wifi' },
  { label: 'Door lock fault', icon: 'lock' },
];
const ITEMS = ['Extra towels', 'Extra pillows', 'Toiletries', 'Iron & board', 'Crib', 'Phone charger'];

export default function GuestApp() {
  const [banners, toast] = usePhoneBanners();
  const { view: v, status, act: run, end } = useJourney();
  const [tab, setTab] = useState<Tab>('home');
  const tabsRef = useSlide<HTMLElement>(tab);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [closing, setClosing] = useState(false);
  const [readCount, setReadCount] = useState<number | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(canNotify() ? Notification.permission : 'unsupported');

  useEffect(() => {
    document.title = v ? `${v.guest.name.split(' ')[0]}’s stay · Founders` : 'Founders Hotel Network';
  }, [v]);

  // New messages → in-app toast, system notification (if allowed), vibration and a chime.
  useEffect(() => {
    if (!v) return;
    if (seen.current === null) {
      seen.current = new Set(v.notifications.map((n) => n.id));
      setReadCount(v.notifications.length);
      return;
    }
    if (v.notifications.length === 0) seen.current = new Set();
    const fresh = v.notifications.filter((n) => !seen.current!.has(n.id)).reverse();
    for (const n of fresh) {
      seen.current.add(n.id);
      toast({ title: n.title, body: n.body, tone: n.kind === 'ready' ? 'good' : 'neutral' });
      if (perm === 'granted') {
        try {
          new Notification(n.title, { body: n.body, icon: '/favicon.svg', tag: n.id });
        } catch {
          /* some mobile browsers require a service worker */
        }
      }
      if ('vibrate' in navigator && navigator.userActivation?.hasBeenActive) navigator.vibrate(n.kind === 'ready' ? [120, 60, 120] : 80);
      chime();
    }
  }, [v, perm, toast]);

  useEffect(() => {
    if (tab === 'chat' && v) setReadCount(v.notifications.length);
  }, [tab, v]);

  const goTab = (next: Tab) => {
    if (next === tab) return;
    withTransition(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 'fwd' : 'back', () => setTab(next));
    document.querySelector('.gx-scroll')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
  const closeSheet = () => {
    setClosing(true);
    setTimeout(() => {
      setSheet(null);
      setClosing(false);
    }, SHEET_EXIT_MS);
  };

  if (status === 'none') return <Navigate to={guestPath('/')} replace />;
  if (!v) {
    return (
      <GuestFrame>
        <div className="gx-pad gx-top-pad">
          <div className="gx-card pad gx-wait" role="status">
            <span className="spinner" aria-hidden="true" />
            <b>{status === 'offline' ? 'Can’t reach the hotel right now' : 'Opening your stay…'}</b>
            {status === 'offline' && <span className="gx-muted">We’ll keep trying — check your connection.</span>}
          </div>
        </div>
      </GuestFrame>
    );
  }

  /** Runs a guest action. `ok: false` when the hotel's own message already confirms it. */
  const act: Act = async (path, body, ok) => {
    try {
      const message = await run(path, body as Record<string, unknown>);
      if (ok !== false) toast({ title: ok ?? 'Done', body: message, tone: 'good' });
      return true;
    } catch (e) {
      toast({ title: 'Not available', body: (e as Error).message, tone: 'bad' });
      return false;
    }
  };

  const enableNotifications = async () => {
    if (!canNotify()) {
      toast({ title: 'In-app alerts are on', body: 'System notifications need HTTPS. Keep the app open and we’ll alert you here.' });
      return;
    }
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') {
      void run('prefs', { notifyBrowser: true }).catch(() => undefined);
      toast({ title: 'Notifications on', body: 'We’ll let you know when your room is ready.', tone: 'good' });
    }
  };

  const unread = Math.max(0, v.notifications.length - (readCount ?? v.notifications.length));
  const tabs = (
    <>
      <nav className="gx-tabs slide" aria-label="App sections" ref={tabsRef}>
        {(
          [
            ['home', 'home', 'Home'],
            ['key', 'key', 'Key'],
            ['requests', 'list', 'Requests'],
            ['chat', 'chat', 'Messages'],
          ] as [Tab, IconName, string][]
        ).map(([t, icon, label]) => (
          <button key={t} className={`gx-tab ${tab === t ? 'on' : ''}`} onClick={() => goTab(t)} aria-current={tab === t ? 'page' : undefined}>
            <Icon name={icon} size={21} />
            {label}
            {t === 'chat' && unread > 0 && <span className="count">{unread}</span>}
          </button>
        ))}
      </nav>
      {sheet && <SheetHost sheet={sheet} v={v} closing={closing} onClose={closeSheet} act={act} />}
    </>
  );

  return (
    <ToastContext.Provider value={toast}>
      <GuestFrame now={v.now} darkStatus={tab !== 'home'} tabs={tabs} demoPace banners={<PhoneBanners items={banners} />}>
        <div className="gx-pane" key={tab}>
          {tab === 'home' && <Home v={v} perm={perm} unread={unread} onEnable={enableNotifications} open={setSheet} go={goTab} act={act} onEnd={end} />}
          {tab === 'key' && <KeyTab v={v} act={act} />}
          {tab === 'requests' && <RequestsTab v={v} open={setSheet} />}
          {tab === 'chat' && <ChatTab v={v} />}
        </div>
      </GuestFrame>
    </ToastContext.Provider>
  );
}

type Act = (path: string, body: unknown, ok?: string | false) => Promise<boolean>;

const BANNER_MS = 3800;
type Banner = Toast & { leaving?: boolean };

/** Notifications inside the phone screen, like a real lock-screen banner. */
function usePhoneBanners(): [Banner[], (t: Omit<Toast, 'id'>) => void] {
  const [items, setItems] = useState<Banner[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-1), { ...t, id }]);
    setTimeout(() => setItems((x) => x.map((y) => (y.id === id ? { ...y, leaving: true } : y))), BANNER_MS - 200);
    setTimeout(() => setItems((x) => x.filter((y) => y.id !== id)), BANNER_MS);
  }, []);
  return [items, push];
}

function PhoneBanners({ items }: { items: Banner[] }) {
  return (
    <div className="gx-banners" role="status" aria-live="polite">
      {items.map((b) => (
        <div key={b.id} className={`gx-banner ${b.tone ?? ''} ${b.leaving ? 'leaving' : ''}`}>
          <div className="grow">
            <div className="meta">
              <span>Founders Hotel Network</span>
              <span>now</span>
            </div>
            <b>{b.title}</b>
            {b.body && <span>{b.body}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Home ─────────────────────────
function Home({ v, perm, unread, onEnable, open, go, act, onEnd }: { v: GuestView; perm: string; unread: number; onEnable: () => void; open: (s: Sheet) => void; go: (t: Tab) => void; act: Act; onEnd: () => Promise<void> }) {
  const nav = useNavigate();
  const first = v.guest.name.split(' ')[0];
  const h = Math.floor(v.now / 60);
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const ready = v.room.status === 'ready';
  const inRoom = v.guest.inRoom;
  const keyLive = ready || inRoom;
  const housekeeping = v.guest.housekeeping === 'green' ? 'Skipping tomorrow' : v.guest.housekeeping === 'dnd' ? 'Do not disturb' : 'Daily';

  return (
    <>
      <header className="gx-hero">
        <div className="gx-top">
          <Brand />
          <button className="gx-iconbtn" onClick={() => go('chat')} aria-label={`Messages${unread ? `, ${unread} new` : ''}`}>
            <Icon name="bell" size={19} />
            {unread > 0 && <span className="badge" />}
          </button>
        </div>
        <h1 className="gx-title">
          {hello}, {first}
        </h1>
        <p className="gx-sub">
          {v.guest.group ? `${v.guest.group} · ` : ''}Party of {v.guest.partySize}
        </p>
      </header>

      <div className="gx-body">
        <RoomStatusCard v={v} go={go} act={act} />
        <section className="gx-card stay-strip" aria-label="Your stay">
          <div>
            <span>Check-in</span>
            <b>{v.stay.arrive}</b>
          </div>
          <div>
            <span>Check-out</span>
            <b>{v.stay.depart}</b>
          </div>
          <div>
            <span>Room</span>
            <b>{v.room.id ?? '—'}</b>
          </div>
        </section>


        {v.elevatorNotice && (
          <div className="notice" role="status">
            <Icon name="alert" size={16} />
            <span>{v.elevatorNotice}</span>
          </div>
        )}

        <section className="gx-group" aria-label="Your room">
          <h3>Your room</h3>
          <div className="gx-list">
            <Row icon="key" label="Mobile key" detail={keyLive ? 'Ready' : 'When room is ready'} hot={keyLive} onClick={() => go('key')} />
            <Row icon="thermo" label="Temperature" detail={climateShort(v.climate.hvac, v.climate.setpoint)} onClick={() => open('climate')} />
            <Row icon="bed" label="Housekeeping" detail={housekeeping} onClick={() => open('housekeeping')} />
            {perm !== 'granted' && <Row icon="bell" label="Notify me on this phone" detail="Off" onClick={onEnable} />}
          </div>
        </section>

        <section className="gx-group" aria-label="Help">
          <h3>Help</h3>
          <div className="gx-list">
            <Row icon="wrench" label="Report a problem" detail={inRoom ? '' : 'Once you’re in'} onClick={() => open('issue')} />
            <Row icon="box" label="Request items" detail="Towels, pillows" onClick={() => open('items')} />
            <Row icon="wifi" label="Wi-Fi" detail="FHN-Guest" onClick={() => open('wifi')} />
          </div>
        </section>

        <section className="gx-group" aria-label="Around the hotel">
          <h3>Around the hotel</h3>
          <div className="explore">
            <Explore icon="utensils" title="Founders Kitchen" sub="Breakfast 6:30–10:30 AM" />
            <Explore icon="coffee" title="Lobby bar" sub="Open 4–11 PM" />
            <Explore icon="bag" title="Bell desk" sub="Bags held free while you wait" />
            <Explore icon="clock" title="Late checkout" sub="Until 1 PM, on request" />
          </div>
        </section>

        <section className="gx-group" aria-label="FHN AI">
          <div className="gx-list">
            <a className="gx-row" href={hotelUrl('/')} target={HOTEL_TAB}>
              <span className="gx-row-ic hot">
                <Icon name="sparkles" size={16} />
              </span>
              <span className="gx-row-label">
                See the hotel’s day
                <small>Explore the operations demo</small>
              </span>
              <Icon name="right" size={15} className="gx-row-go" />
            </a>
          </div>
        </section>

        <div className="gx-foot">
          This app shows only your booking. Demo data, saved with the hotel.
          <button className="gx-end" onClick={() => void onEnd().then(() => nav(guestPath('/')))}>
            End this stay
          </button>
        </div>
      </div>
    </>
  );
}

/** A row in a grouped list, like iOS Settings. */
function Row({ icon, label, detail, hot, onClick }: { icon: IconName; label: string; detail?: string; hot?: boolean; onClick: () => void }) {
  return (
    <button className="gx-row" onClick={onClick}>
      <span className={`gx-row-ic ${hot ? 'hot' : ''}`}>
        <Icon name={icon} size={16} />
      </span>
      <span className="gx-row-label">{label}</span>
      {detail && <span className="gx-row-detail">{detail}</span>}
      <Icon name="right" size={15} className="gx-row-go" />
    </button>
  );
}

function RoomStatusCard({ v, go, act }: { v: GuestView; go: (t: Tab) => void; act: Act }) {
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = v.room;

  if (v.guest.canCheckIn) {
    return (
      <section className="gx-card room-status" key="checkin">
        <span className="rs-k">Online check-in</span>
        <h2>Skip the front desk</h2>
        <ul className="checkin-list">
          <li>
            <Icon name="clock" size={17} /> See exactly when your room will be ready
          </li>
          <li>
            <Icon name="bell" size={17} /> Notify me when it’s ready
          </li>
          <li>
            <Icon name="key" size={17} /> Go straight up with your mobile key
          </li>
        </ul>
        <button
          className="gbtn brass"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await act('check-in', {}, false);
            setBusy(false);
          }}
        >
          {busy ? 'Checking you in…' : 'Check in now'}
        </button>
      </section>
    );
  }
  if (v.guest.inRoom) {
    return (
      <section className="gx-card room-status" key="in">
        <span className="rs-k">You&rsquo;re in</span>
        <h2>Welcome to room {r.id}</h2>
        <p className="rs-note">
          Floor {r.floor} · {r.type}. Need anything? Send a request or contact the front desk below.
        </p>
      </section>
    );
  }
  if (r.status === 'ready') {
    return (
      <section className="gx-card room-status ready-card" key="ready">
        <span className="rs-k">Ready{r.readyAt ? ` since ${fmtTime(Math.floor(r.readyAt))}` : ''}</span>
        <h2>Room {r.id} is ready</h2>
        <p className="rs-note">Floor {r.floor}. Your mobile key opens the room door and the elevator.</p>
        <button className="gbtn white" onClick={() => go('key')}>
          <Icon name="key" size={17} /> Open mobile key
        </button>
      </section>
    );
  }
  if (r.status === 'ooo') {
    return (
      <section className="gx-card room-status" key="repair">
        <span className="rs-k">We&rsquo;re on it</span>
        <h2>Moving you to another room</h2>
        {v.ticket && (
          <p className="rs-note">
            Ticket {v.ticket.id}: {v.ticket.issue}. Owner: {v.ticket.owner}.
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="gx-card room-status" key="eta" aria-live="polite">
      <span className="rs-k">Room {r.id} · ready by</span>
      <div className="eta">{r.eta ? fmtTime(r.eta.high) : 'Scheduling…'}</div>
      {v.progress && <Countdown p={v.progress} />}
      <Steps status={r.status} />
      <div className="ai-line">
        <Icon name="sparkles" size={14} /> {r.eta ? `FHN AI estimate · most likely ${fmtRange(r.eta.low, r.eta.high)}` : 'FHN AI is checking with housekeeping'}
      </div>
      {r.eta && (
        <>
          <button className="why-toggle" onClick={() => setWhy(!why)} aria-expanded={why}>
            How FHN AI worked this out <Icon name="down" size={14} />
          </button>
          {why && (
            <div className="why-box">
              <ul>
                {r.eta.drivers.map((d) => (
                  <li key={d}>{d}</li>
                ))}
                <li>We promise the late end of the window ({SURE[r.eta.confidence]}).</li>
              </ul>
            </div>
          )}
        </>
      )}
      <p className="rs-note">No need to wait in the lobby — leave your bags at the bell desk and we&rsquo;ll message you.</p>
    </section>
  );
}

/** Time left until the promised time, as a bar that fills. */
function Countdown({ p }: { p: NonNullable<GuestView['progress']> }) {
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - p.startMs) / (p.highMs - p.startMs)) * 100));
  const left = Math.max(0, Math.round((p.highMs - now) / 1000));
  const text = left >= 60 ? `About ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s left` : `Under ${Math.max(1, left)} s left`;
  return (
    <div className="countdown" aria-label={text}>
      <div className="cd-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="cd-left">{text}</span>
    </div>
  );
}

function Steps({ status }: { status: RoomStatus }) {
  const idx = status === 'occupied' ? 0 : status === 'dirty' || status === 'stayover' || status === 'cleaning' ? 1 : status === 'inspection' ? 2 : 3;
  const labels = ['Guest out', 'Cleaning', 'Final check', 'Ready'];
  return (
    <div className="gx-steps" aria-label={`Progress: ${labels[idx]}`}>
      {labels.map((l, i) => {
        const active = i === idx && (status === 'cleaning' || status === 'inspection' || status === 'occupied');
        return (
          <div key={l} className={`gx-step ${i < idx ? 'done' : ''} ${active ? 'active' : ''}`}>
            <i />
            {l}
          </div>
        );
      })}
    </div>
  );
}

function Explore({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <div className="ex-card">
      <div className="ex-art">
        <Icon name={icon} size={22} strokeWidth={1.8} />
      </div>
      <div className="txt">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

const climateShort = (h: Hvac, sp: number) => (h === 'eco' ? 'Saving energy' : h === 'precool' ? `Getting to ${sp}°` : `${sp}°C`);
const SURE = { high: 'very likely', medium: 'likely', low: 'rough estimate' } as const;

// ───────────────────────── Key ─────────────────────────
function KeyTab({ v, act }: { v: GuestView; act: Act }) {
  const [open, setOpen] = useState(false);
  const live = v.room.status === 'ready' || v.guest.inRoom;
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), 2200);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <>
      <div className="gx-page-head gx-top-pad">
        <h1>Mobile key</h1>
        <p>{live ? 'Hold your phone near the lock.' : 'Your key will activate when your room is ready.'}</p>
      </div>
      <div className="key-wrap">
        <div className={`key-card ${live ? '' : 'locked'}`}>
          {live && <span className="shine" />}
          <div className="row" style={{ justifyContent: 'space-between', position: 'relative' }}>
            <Brand sub="Toronto Downtown" />
            <Icon name={live ? 'key' : 'lock'} size={20} />
          </div>
          <div style={{ position: 'relative' }}>
            <div className="gx-label" style={{ color: 'rgba(255,255,255,.7)' }}>
              Room
            </div>
            <div className="room">{v.room.id ?? '—'}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
              {v.guest.name} · until {v.stay.depart}
            </div>
          </div>
        </div>
        {live ? (
          <>
            <button
              className={`nfc ${open ? 'open' : 'active'}`}
              onClick={() => {
                setOpen(true);
                void act('unlock', {}, false);
              }}
              aria-label="Unlock door"
            >
              <Icon name={open ? 'check' : 'door'} size={40} strokeWidth={1.7} />
            </button>
            <b>{open ? `Room ${v.room.id} unlocked` : 'Tap to unlock (demo)'}</b>
          </>
        ) : (
          <div className="gx-card pad" style={{ width: '100%' }}>
            <span className="gx-label">Activates</span>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
              {v.room.eta ? fmtRange(v.room.eta.low, v.room.eta.high) : v.guest.canCheckIn ? 'After online check-in' : 'When your room is ready'}
            </div>
            <p className="gx-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              We&rsquo;ll message you the second it&rsquo;s ready.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ───────────────────────── Requests ─────────────────────────
const REQ_STEPS: { key: GuestRequest['status']; label: (r: GuestRequest) => string }[] = [
  { key: 'received', label: (r) => `Reported ${fmtTime(r.openedAt)}` },
  { key: 'assigned', label: (r) => (r.owner ? `${r.owner} has it${r.ticketId ? ` · request ${r.ticketId}` : ''}` : 'Waiting for someone to take it') },
  { key: 'on-the-way', label: (r) => (r.etaAt ? `On the way · by ${fmtTime(r.etaAt)}` : 'On the way') },
  { key: 'resolved', label: (r) => (r.resolvedAt ? `${r.kind === 'issue' ? 'Fixed' : 'Delivered'} ${fmtTime(r.resolvedAt)}` : r.kind === 'issue' ? 'Fixed' : 'Delivered') },
];

function RequestsTab({ v, open }: { v: GuestView; open: (s: Sheet) => void }) {
  return (
    <>
      <div className="gx-page-head gx-top-pad">
        <h1>Requests</h1>
        <p>Report something once. You&rsquo;ll always see who has it and when.</p>
      </div>
      <div className="gx-pad">
        <div className="row">
          <button className="gbtn navy" onClick={() => open('issue')}>
            <Icon name="wrench" size={16} /> Report issue
          </button>
          <button className="gbtn soft" onClick={() => open('items')}>
            <Icon name="box" size={16} /> Request items
          </button>
        </div>
        {v.requests.length === 0 ? (
          <div className="gx-card pad gx-muted" style={{ fontSize: 14 }}>
            No requests yet.
          </div>
        ) : (
          <div className="gx-card">
            {v.requests.map((r) => (
              <RequestItem key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RequestItem({ r }: { r: GuestRequest }) {
  const idx = REQ_STEPS.findIndex((s) => s.key === r.status);
  return (
    <div className="req">
      <div className="req-head">
        <div>
          <b>{r.title}</b>
          <div className="gx-muted" style={{ fontSize: 12.5 }}>
            Room {r.roomId}
          </div>
        </div>
        <span className={`pill ${r.status === 'resolved' ? 'green' : r.owner ? 'ai' : 'amber'}`}>{r.status === 'resolved' ? 'Done' : r.owner ? 'In progress' : 'Sent'}</span>
      </div>
      <ol className="req-steps">
        {REQ_STEPS.map((s, i) => (
          <li key={s.key} className={i < idx || r.status === 'resolved' ? 'done' : i === idx ? 'now' : ''}>
            <span className="bullet">{i < idx || r.status === 'resolved' ? <Icon name="check" size={12} strokeWidth={3} /> : null}</span>
            <span>{s.label(r)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────────── Messages ─────────────────────────
function ChatTab({ v }: { v: GuestView }) {
  const thread = [...v.notifications].reverse();
  return (
    <>
      <div className="gx-page-head gx-top-pad">
        <h1>Messages</h1>
        <p>From the front desk · Toronto Downtown</p>
      </div>
      <div className="chat">
        <span className="chat-day">Today</span>
        {thread.length === 0 && <div className="bubble gx-muted">Welcome to Founders! We&rsquo;ll message you here as soon as we have news about your room.</div>}
        {thread.map((n) => (
          <div key={n.id} className={`bubble ${n.kind}`}>
            <div className="meta">
              <b style={{ color: 'var(--g-ink)' }}>{n.title}</b>
              <span className="num">{fmtTime(n.at)}</span>
            </div>
            {n.body}
          </div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── Sheets ─────────────────────────
function SheetHost({ sheet, v, closing, onClose, act }: { sheet: Sheet; v: GuestView; closing: boolean; onClose: () => void; act: Act }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {sheet === 'climate' && <ClimateSheet v={v} act={act} onClose={onClose} />}
        {sheet === 'housekeeping' && <HousekeepingSheet v={v} act={act} onClose={onClose} />}
        {sheet === 'issue' && <IssueSheet v={v} act={act} onClose={onClose} />}
        {sheet === 'items' && <ItemsSheet v={v} act={act} onClose={onClose} />}
        {sheet === 'wifi' && <WifiSheet onClose={onClose} />}
      </div>
    </div>
  );
}

function SheetHead({ title, sub, onClose }: { title: string; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <button className="round" onClick={onClose} aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

const HVAC_TEXT: Record<Hvac, string> = {
  eco: 'Energy saver while the room is empty',
  precool: 'Getting your room ready for you',
  comfort: 'Comfortable',
  running: 'Heating or cooling at full',
};

function ClimateSheet({ v, act, onClose }: { v: GuestView; act: Act; onClose: () => void }) {
  const [sp, setSp] = useState(v.climate.setpoint);
  const set = (n: number) => {
    const next = Math.min(25, Math.max(18, n));
    setSp(next);
    void act('climate', { setpoint: next }, `Set to ${next}°C`);
  };
  const away = v.climate.awayUntil !== null && v.climate.awayUntil > v.now;
  return (
    <>
      <SheetHead
        title="Room temperature"
        sub={v.guest.inRoom ? 'We save energy only while you’re out — never while you’re in.' : `Your room saves energy while it’s empty and will be at ${sp}°C when you walk in.`}
        onClose={onClose}
      />
      <div className="dial">
        <button className="round" onClick={() => set(sp - 1)} aria-label="Cooler">
          <Icon name="minus" size={18} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div className="temp">
            {sp}
            <sup>°C</sup>
          </div>
          <span className={`hvac-badge ${v.climate.hvac}`} style={{ marginTop: 8 }}>
            <Icon name={v.climate.hvac === 'eco' ? 'leaf' : v.climate.hvac === 'precool' ? 'clock' : 'thermo'} size={13} />
            {HVAC_TEXT[v.climate.hvac]}
          </span>
        </div>
        <button className="round" onClick={() => set(sp + 1)} aria-label="Warmer">
          <Icon name="plus" size={18} />
        </button>
      </div>
      {v.guest.inRoom && (
        <div style={{ marginTop: 14 }}>
          <span className="gx-label">{away ? `Out until ~${fmtTime(v.climate.awayUntil!)}` : 'Heading out?'}</span>
          <div className="chips" style={{ marginTop: 8 }}>
            {away ? (
              <>
                <button className="chip" onClick={() => act('climate', { awayMinutes: 15 }, 'We’ll have it ready in 15 min')}>
                  <Icon name="arrow" size={14} /> Back in 15 min
                </button>
                <button className="chip" onClick={() => act('climate', { awayMinutes: null }, 'Welcome back')}>
                  <Icon name="home" size={14} /> I&rsquo;m back
                </button>
              </>
            ) : (
              [60, 120, 240].map((m) => (
                <button key={m} className="chip" onClick={() => act('climate', { awayMinutes: m }, 'Eco while you’re out')}>
                  Out for {m / 60} h
                </button>
              ))
            )}
          </div>
          <p className="gx-muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
            Your room returns to {sp}°C about 20 minutes before you&rsquo;re back.
          </p>
        </div>
      )}
    </>
  );
}

function HousekeepingSheet({ v, act, onClose }: { v: GuestView; act: Act; onClose: () => void }) {
  const opts: { key: HousekeepingPref; icon: IconName; title: string; sub: string }[] = [
    { key: 'standard', icon: 'bed', title: 'Daily cleaning', sub: 'Fresh towels and a tidy room each day' },
    { key: 'green', icon: 'leaf', title: 'Skip tomorrow’s cleaning', sub: 'Earn 500 Founders points. Fresh towels any time — just ask.' },
    { key: 'dnd', icon: 'moon', title: 'Do not disturb', sub: 'No cleaning until you change this' },
  ];
  return (
    <>
      <SheetHead title="Housekeeping" sub="Tell us early — it helps our team plan tomorrow’s schedule." onClose={onClose} />
      {opts.map((o) => (
        <button key={o.key} className={`opt ${v.guest.housekeeping === o.key ? 'on' : ''}`} onClick={() => act('housekeeping', { pref: o.key }, 'Saved')}>
          <span className="ic">
            <Icon name={o.icon} size={18} />
          </span>
          <span>
            <b>{o.title}</b>
            <span>{o.sub}</span>
          </span>
          <span className="radio" />
        </button>
      ))}
    </>
  );
}

function IssueSheet({ v, act, onClose }: { v: GuestView; act: Act; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!v.guest.inRoom) {
    return (
      <>
        <SheetHead title="Report a problem" onClose={onClose} />
        <div className="gx-card pad gx-muted" style={{ fontSize: 14 }}>
          You can report a problem once you&rsquo;re in your room. Before that, the front desk is happy to help.
        </div>
      </>
    );
  }
  return (
    <>
      <SheetHead title="Report a problem" sub={`Room ${v.room.id} · Tell us what needs attention. You can follow the repair here.`} onClose={onClose} />
      <div className="chips">
        {ISSUES.map((i) => (
          <button key={i.label} className={`chip ${pick === i.label ? 'on' : ''}`} onClick={() => setPick(i.label)}>
            <Icon name={i.icon} size={14} /> {i.label}
          </button>
        ))}
      </div>
      <button
        className="gbtn navy"
        style={{ marginTop: 16 }}
        disabled={!pick || busy}
        onClick={async () => {
          setBusy(true);
          if (await act('issue', { issue: pick }, false)) onClose();
          setBusy(false);
        }}
      >
        <Icon name="send" size={16} /> Send report
      </button>
    </>
  );
}

function ItemsSheet({ v, act, onClose }: { v: GuestView; act: Act; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  if (!v.guest.inRoom) {
    return (
      <>
        <SheetHead title="Request items" onClose={onClose} />
        <div className="gx-card pad gx-muted" style={{ fontSize: 14 }}>
          Requests open once you&rsquo;re in your room.
        </div>
      </>
    );
  }
  return (
    <>
      <SheetHead title="Request items" sub={`Delivered to room ${v.room.id}`} onClose={onClose} />
      <div className="chips">
        {ITEMS.map((i) => (
          <button key={i} className={`chip ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
            {i}
          </button>
        ))}
      </div>
      <button
        className="gbtn navy"
        style={{ marginTop: 16 }}
        disabled={!pick}
        onClick={async () => {
          if (await act('request', { item: pick }, false)) onClose();
        }}
      >
        <Icon name="send" size={16} /> Send request
      </button>
    </>
  );
}

function WifiSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  return (
    <>
      <SheetHead title="Wi-Fi" sub="Free for every guest, on every floor." onClose={onClose} />
      <div className="gx-card pad">
        <span className="gx-label">Network</span>
        <div style={{ fontSize: 20, fontWeight: 700 }}>FHN-Guest</div>
        <span className="gx-label" style={{ display: 'block', marginTop: 10 }}>
          Password
        </span>
        <div style={{ fontSize: 20, fontWeight: 700 }}>founders2026</div>
      </div>
      <button
        className="gbtn soft"
        style={{ marginTop: 12 }}
        onClick={() => {
          navigator.clipboard?.writeText('founders2026').then(
            () => toast({ title: 'Password copied', tone: 'good' }),
            () => toast({ title: 'Copy not available here' }),
          );
        }}
      >
        Copy password
      </button>
    </>
  );
}
