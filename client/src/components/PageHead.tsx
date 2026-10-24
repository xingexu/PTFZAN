import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSlide } from './slide';

/** One-line page header for the hotel view: a title and the page's own controls. */
const SUBTITLES: Record<string, string> = {
  Rooms: 'Room status, ready times and arrivals.',
  Team: 'Housekeeping assignments and staffing.',
  Housekeeping: 'The right rooms, in the right order.',
  Maintenance: 'Open repairs and recurring issues.',
  Energy: 'Comfort for guests. Less energy in empty rooms.',
  Building: 'Repairs, maintenance and room temperature.',
};

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="hq-head">
      <div><span className="page-eyebrow">TORONTO DOWNTOWN</span><h1>{title}</h1>{SUBTITLES[title] && <p className="page-subtitle">{SUBTITLES[title]}</p>}</div>
      {children && <div className="hq-head-actions">{children}</div>}
    </div>
  );
}

/** Team = the supervisor's board and an attendant's phone. */
export function TeamTabs() {
  const ref = useSlide<HTMLElement>(useLocation().pathname);
  return (
    <nav className="layer-seg slide" aria-label="Team views" ref={ref}>
      <NavLink to="/supervisor" viewTransition className={({ isActive }) => (isActive ? 'on' : '')}>
        Supervisor
      </NavLink>
      <NavLink to="/attendant" viewTransition className={({ isActive }) => (isActive ? 'on' : '')}>
        Attendant phone
      </NavLink>
    </nav>
  );
}
