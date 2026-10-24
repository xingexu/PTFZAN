import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtTime, type Room } from '../../../shared/types';
import { useSim } from '../api';
import { Icon } from '../components/Icon';
import { atRisk, STATUS_LABEL, visibleStatus } from '../components/rooms';
import { RoomTile } from './FrontDesk';

/** The day's actionable room state; the detailed before/after demo has its own screen. */
export default function Overview() {
  const { state: s } = useSim();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'arriving' | 'risk'>('all');
  const [query, setQuery] = useState('');
  if (!s) return null;
  const ready = s.rooms.filter((r) => visibleStatus(s, r) === 'ready').length;
  const arrivals = s.guests.filter((g) => !g.inHouse && !g.isDemoGuest && g.state !== 'checked-in').sort((a, b) => a.expectedArrival - b.expectedArrival);
  const nextHour = arrivals.filter((g) => g.expectedArrival >= s.now && g.expectedArrival <= s.now + 60).length;
  const pending = s.proposals.find((p) => p.status === 'pending');
  const tickets = s.tickets.filter((t) => t.status === 'open');
  const attention = tickets.length + (pending ? 1 : 0);
  const attendants = s.attendants.filter((a) => a.present);
  const matches = (r: Room) => r.id.includes(query.trim()) && (filter === 'all' || (filter === 'arriving' ? arrivals.some((g) => g.roomId === r.id) : atRisk(s, r) || r.status === 'ooo'));
  const matchCount = s.rooms.filter(matches).length;
  const weddingRooms = s.rooms.filter((r) => r.groupBlock);
  const weddingReady = weddingRooms.filter((r) => visibleStatus(s, r) === 'ready').length;

  return (
    <main className="page overview-page">
      <section className="overview-hero" aria-label="Today at a glance">
        <div className="overview-greeting"><span className="page-eyebrow">FRIDAY, OCTOBER 16</span><h1>Today at<br className="mobile-break" /> Toronto Downtown</h1><p>{ready} rooms ready <span>·</span> {nextHour} arrivals in the next hour</p></div>
        <div className="overview-metrics">
          <Link to="/front-desk" className="overview-metric"><span className="metric-icon green"><Icon name="bed" size={21} /></span><div><span>Ready for arrival</span><strong>{ready}<small> / 48</small></strong></div></Link>
          <Link to="/front-desk" className="overview-metric"><span className="metric-icon blue"><Icon name="users" size={21} /></span><div><span>Guests waiting</span><strong>{s.metrics.lobbyWaiting}</strong></div></Link>
          <a href="#overview-attention" className="overview-metric"><span className="metric-icon amber"><Icon name="alert" size={21} /></span><div><span>Needs attention</span><strong>{attention}</strong></div></a>
        </div>
      </section>
      <div className="overview-layout">
        <section className="card overview-rooms" aria-label="Room readiness">
          <div className="overview-card-head"><h2>Room readiness</h2><Link to="/front-desk" className="text-link">View rooms <Icon name="right" size={14} /></Link></div>
          <div className="overview-room-tools">
            <div className="room-highlights" role="group" aria-label="Filter room readiness">
              {([['all', 'All rooms'], ['arriving', 'Arriving today'], ['risk', 'At risk']] as const).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
            </div>
            <label className="room-search"><Icon name="bed" size={15} /><input type="search" inputMode="numeric" placeholder="Search rooms…" aria-label="Search room readiness" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          </div>
          <span className="sr-only" role="status">{matchCount} matching rooms highlighted</span>
          <div className="overview-floors">
            {[6, 5, 4, 3].map((floor) => <div className="overview-floor" key={floor}><div className="overview-floor-label"><b>{floor}</b><span>12 rooms</span></div><div className="overview-floor-rooms">{s.rooms.filter((r) => r.floor === floor).map((r) => <RoomTile key={r.id} s={s} r={r} layer="readiness" selected={false} dimmed={!matches(r)} onClick={() => navigate(`/front-desk?room=${r.id}`)} />)}</div></div>)}
          </div>
          <div className="overview-legend"><span><i className="ready" />Ready</span><span><i className="cleaning" />Cleaning</span><span><i className="inspection" />Final check</span><span><i className="dirty" />To clean</span><span><i className="occupied" />Guest in</span><span><i className="ooo" />Repair</span></div>
        </section>
        <aside className="overview-side">
          <section className="card attention-card" id="overview-attention" aria-label="Needs attention">
            <div className="overview-card-head"><h2>Attention <span>({attention})</span></h2><Icon name="bell" size={17} /></div>
            <div className="attention-items">
              {pending && <Link to="/supervisor" className="attention-item"><span className="metric-icon amber"><Icon name="users" size={19} /></span><div><b>{pending.trigger}</b><p>{pending.changes.length} rooms · approval needed</p><span className="attention-action">Review plan <Icon name="right" size={12} /></span></div></Link>}
              {tickets.slice(0, 2).map((t) => <Link to={t.roomId ? `/front-desk?room=${t.roomId}` : '/engineering'} className="attention-item" key={t.id}><span className="metric-icon amber"><Icon name="wrench" size={19} /></span><div><b>{t.asset}</b><p>{t.issue}</p><span className="attention-meta">{t.owner}</span></div><Icon name="right" size={15} /></Link>)}
              {attention === 0 && <div className="attention-item"><span className="metric-icon green"><Icon name="check" size={19} /></span><div><b>All caught up</b><p>No decisions or repairs waiting.</p></div></div>}
              <Link to="/front-desk" className="attention-item wedding-item"><span className="metric-icon blue"><Icon name="users" size={19} /></span><div><b>Wedding arrivals</b><p>{weddingReady} of {weddingRooms.length} rooms ready</p></div><Icon name="right" size={15} /></Link>
            </div>
          </section>
          <section className="card next-arrivals" aria-label="Next arrivals">
            <div className="overview-card-head"><h2>Next arrivals</h2><Link className="text-link" to="/front-desk">View all</Link></div>
            <div className="next-arrival-list">{arrivals.slice(0, 3).map((g) => {
              const r = s.rooms.find((room) => room.id === g.roomId);
              if (!r) return null;
              const status = visibleStatus(s, r);
              return <Link key={g.code} to={`/front-desk?room=${r.id}`} className="next-arrival"><span className="arrival-avatar"><Icon name="user" size={17} /></span><div><b>{g.name}</b><small>Room {r.id} · {fmtTime(g.expectedArrival)}</small></div><span className={`pill ${status === 'ready' ? 'green' : status === 'ooo' ? 'red' : 'slate'}`}>{status === 'ready' ? 'Ready' : s.mode === 'ai' && r.eta ? `By ${fmtTime(r.eta.high)}` : STATUS_LABEL[status]}</span></Link>;
            })}{arrivals.length === 0 && <p className="empty">Everyone has checked in.</p>}</div>
          </section>
        </aside>
      </div>
      <section className="card overview-team" aria-label="Housekeeping today">
        <div className="overview-card-head"><div className="overview-team-title"><h2>Housekeeping today</h2><span>{attendants.length} attendants on shift</span></div><Link className="text-link" to="/supervisor">View team <Icon name="right" size={14} /></Link></div>
        <div className="overview-team-grid">{attendants.map((a) => {
          const rooms = [...(a.currentRoom ? [a.currentRoom] : []), ...a.queue];
          return <Link to="/supervisor" className="overview-attendant" key={a.id}><div className="overview-attendant-head"><span className="arrival-avatar"><Icon name="user" size={17} /></span><div><b>{a.label}</b><small>{rooms.length ? `${rooms.length} rooms in queue` : 'Queue complete'}</small></div><span className="team-status-dot" /></div>{rooms.slice(0, 3).map((id, i) => <div className="overview-task" key={id}><b>{id}</b><span>{i === 0 && a.currentRoom ? 'Cleaning now' : 'Up next'}</span><Icon name={i === 0 && a.currentRoom ? 'sparkles' : 'right'} size={13} /></div>)}{rooms.length === 0 && <div className="overview-task"><Icon name="check" size={14} /><span>Available to help</span></div>}</Link>;
        })}</div>
      </section>
    </main>
  );
}
