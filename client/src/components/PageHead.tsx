import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSlide } from './slide';

/** One-line page header for the hotel view: a title and the page's own controls. */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="hq-head">
      <h1>{title}</h1>
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
