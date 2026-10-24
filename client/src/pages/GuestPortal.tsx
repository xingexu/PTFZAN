import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Eta, GuestNotification, GuestState, Mode, RoomStatus, RoomType } from '../../../shared/types';
import { fmtRange, fmtTime } from '../../../shared/types';
import { api, useEventStream, useToast } from '../api';
import { Logo } from '../components/Logo';

interface GuestView {
  mode: Mode;
  now: number;
  hotel: string;
  guest: { code: string; name: string; partySize: number; group?: string; state: GuestState; consentSms: boolean; notifyBrowser: boolean; phoneMasked: string; isDemoGuest: boolean };
  room: { id: string | null; type: RoomType; status: RoomStatus; eta: Eta | null; readyAt: number | null; floor: number };
  elevatorNotice: string | null;
  ticket: { id: string; owner: string; issue: string } | null;
  notifications: GuestNotification[];
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.16);
      o.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1000);
  } catch {
    /* audio not available */
  }
}

export default function GuestPortal() {
  const { code = '' } = useParams();
  const toast = useToast();
  const { data: v, conn, error } = useEventStream<GuestView>(`/api/guest/${encodeURIComponent(code)}/stream`);
  const seen = useRef<Set<string> | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(canNotify() ? Notification.permission : 'unsupported');

  // Surface new messages as an in-page toast, a system notification (if allowed) and a vibration.
  useEffect(() => {
    if (!v) return;
    if (seen.current === null) {
      seen.current = new Set(v.notifications.map((n) => n.id));
      return;
    }
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
      if ('vibrate' in navigator) navigator.vibrate?.(n.kind === 'ready' ? [120, 60, 120] : 80);
      chime();
    }
  }, [v, perm, toast]);

  useEffect(() => {
    document.title = v ? `Your room · ${v.hotel}` : 'Your room · FHN';
  }, [v]);

  const enable = async () => {
    if (!canNotify()) {
      toast({ title: 'In-page alerts are on', body: 'System notifications need HTTPS. Keep this page open and we’ll alert you here.' });
      return;
    }
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') {
      await api(`/api/guest/${code}/prefs`, { notifyBrowser: true }).catch(() => undefined);
      toast({ title: 'Notifications on', body: 'We’ll let you know the moment your room is ready.', tone: 'good' });
    }
  };

  if (error) {
    return (
      <div className="guest-wrap">
        <div className="guest">
          <Header />
          <div className="card status-card" style={{ marginTop: 30 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Booking not found</h1>
            <p className="muted">{error}. Check the code in your confirmation, or join the demo as a new guest.</p>
            <Link to="/join" className="btn primary block">Join as a wedding guest</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!v) {
    return (
      <div className="guest-wrap">
        <div className="guest">
          <Header />
          <div className="card status-card" style={{ marginTop: 30 }}>
            <div className="muted">{conn === 'reconnecting' ? 'Reconnecting…' : 'Loading your stay…'}</div>
          </div>
        </div>
      </div>
    );
  }

  const first = v.guest.name.split(' ')[0];
  const r = v.room;
  const ready = r.status === 'ready';
  const rp = v.mode === 'readypath';

  return (
    <div className="guest-wrap">
      <div className="guest">
        <Header hotel={v.hotel} />
        <div className="guest-hero">
          <h1>{ready || v.guest.state === 'checked-in' ? `Welcome in, ${first}.` : `Welcome, ${first}.`}</h1>
          <p>
            {v.guest.group ? `${v.guest.group} · ` : ''}
            {r.type} · Party of {v.guest.partySize}
          </p>
        </div>

        {!rp ? (
          <section className="card status-card">
            <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>ROOM STATUS</div>
            <div className="big" style={{ fontSize: 24 }}>{ready ? 'Your room is ready' : 'Please see the front desk'}</div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {ready ? 'Visit the front desk to collect your key.' : 'Our team will update you at check-in.'}
            </p>
            <p className="muted" style={{ margin: '14px 0 0', fontSize: 12.5, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              This is the guest experience <b>without</b> ReadyPath. Switch the demo to &ldquo;With ReadyPath&rdquo; to see live ETAs.
            </p>
          </section>
        ) : ready ? (
          <section className="card status-card ready-burst">
            <div style={{ fontWeight: 700, fontSize: 13, opacity: 0.9 }}>READY{r.readyAt ? ` SINCE ${fmtTime(r.readyAt)}` : ''}</div>
            <div className="big">Room {r.id} is ready</div>
            <p className="muted" style={{ margin: '4px 0 14px' }}>Floor {r.floor}. Skip the line — your mobile key works on the room door and elevator.</p>
            <button
              className="btn lg block"
              style={{ background: '#fff', color: 'var(--green)', border: 0 }}
              onClick={() => toast({ title: 'Mobile key added', body: `Room ${r.id} key is in your wallet (demo).`, tone: 'good' })}
            >
              Add mobile key
            </button>
          </section>
        ) : r.status === 'ooo' ? (
          <section className="card status-card">
            <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>WE&rsquo;RE ON IT</div>
            <div className="big" style={{ fontSize: 24 }}>Finding you another room</div>
            {v.ticket && <p className="muted">Ticket {v.ticket.id}: {v.ticket.issue}. Owner: {v.ticket.owner}.</p>}
          </section>
        ) : (
          <section className="card status-card" aria-live="polite">
            <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>EXPECTED READY</div>
            <div className="big mono" style={{ fontFamily: 'var(--mono)' }}>{r.eta ? fmtRange(r.eta.low, r.eta.high) : 'Scheduling…'}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Room {r.id} · {r.eta ? `${r.eta.confidence} confidence` : 'estimate coming shortly'}
            </div>
            <Steps status={r.status} />
            <p className="muted" style={{ margin: '12px 0 0', fontSize: 13.5 }}>Relax — no need to wait in the lobby. Bags can be stored at the bell desk.</p>
          </section>
        )}

        {rp && v.elevatorNotice && (
          <div className="card card-pad" style={{ marginTop: 12, background: 'var(--amber-soft)', borderColor: '#f0dcb4', fontSize: 14 }}>
            ⚠︎ {v.elevatorNotice}
          </div>
        )}

        {rp && (
          <section style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Messages</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>{v.guest.consentSms ? `Also by text to ${v.guest.phoneMasked}` : 'On this page'}</span>
            </div>
            {v.notifications.length === 0 ? (
              <div className="card card-pad muted" style={{ fontSize: 14 }}>No messages yet. We&rsquo;ll send your ETA as soon as it&rsquo;s confirmed.</div>
            ) : (
              <div className="msgs">
                {v.notifications.map((n) => (
                  <div key={n.id} className={`msg ${n.kind}`}>
                    <div className="mt">
                      <b style={{ color: 'var(--ink)' }}>{n.title}</b>
                      <span className="mono">{fmtTime(n.at)}</span>
                    </div>
                    <div style={{ fontSize: 14.5 }}>{n.body}</div>
                  </div>
                ))}
              </div>
            )}

            {perm !== 'granted' && !ready && (
              <button className="btn primary lg block" style={{ marginTop: 16 }} onClick={enable}>
                🔔 Notify me when my room is ready
              </button>
            )}
            {perm === 'granted' && !ready && <p className="muted" style={{ textAlign: 'center', fontSize: 13.5, marginTop: 14 }}>🔔 Notifications are on.</p>}
          </section>
        )}

        <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 28 }}>
          This page shows only your booking. Text messages are sent only with your consent. · Simulated demo data
        </p>
      </div>
    </div>
  );
}

function Header({ hotel }: { hotel?: string }) {
  return (
    <div className="guest-top">
      <Logo className="brand-mark" />
      <div>
        <div className="h">{hotel ?? 'Founders Hotel Network'}</div>
        <div className="s">Founders Hotel Network</div>
      </div>
    </div>
  );
}

function Steps({ status }: { status: RoomStatus }) {
  const idx = status === 'occupied' ? 0 : status === 'dirty' || status === 'stayover' ? 1 : status === 'cleaning' ? 1 : status === 'inspection' ? 2 : 3;
  const labels = ['Previous guest out', 'Cleaning', 'Inspection', 'Ready'];
  return (
    <div className="steps" aria-label={`Progress: ${labels[idx]}`}>
      {labels.map((l, i) => {
        const done = i < idx;
        const active = i === idx && (status === 'cleaning' || status === 'inspection' || status === 'occupied');
        return (
          <div key={l} className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
            <div className="bar" />
            {l}
          </div>
        );
      })}
    </div>
  );
}
