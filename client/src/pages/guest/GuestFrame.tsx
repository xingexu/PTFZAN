import { useLayoutEffect, type ReactNode } from 'react';
import { fmtTime } from '../../../../shared/types';
import { Icon } from '../../components/Icon';
import { Brand } from '../../components/Logo';
import { SECONDS_PER_HOTEL_MINUTE } from '../../../../shared/guest/stay';
import { HOTEL_TAB, hotelUrl } from '../../links';

/**
 * Phones get the app full-screen. On a laptop or projector the app sits in a phone frame,
 * with a short explanation beside it for the audience.
 */
export function GuestFrame({
  children, now, darkStatus, tabs, demoPace, banners,
}: { children: ReactNode; now?: number; darkStatus?: boolean; tabs?: ReactNode; demoPace?: boolean; banners?: ReactNode }) {
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, []);
  return (
    <div className="gx">
      <div className="backdrop" aria-hidden="true" />
      <div className="gx-stage">
        <aside className="gx-aside">
          <Brand />
          <span className="eyebrow">Toronto Downtown · Guest app</span>
          <h1>Welcome to<br />Toronto Downtown.</h1>
          <p>Check in, see when your room is ready, and use your mobile key.</p>
          {demoPace && (
            <span className="live-pill on">
              <span className="dot" /> Demo speed · one hotel minute every {SECONDS_PER_HOTEL_MINUTE} seconds
            </span>
          )}
          <ul>
            <li>
              <Icon name="clock" size={16} /> Check in online and see when your room will be ready
            </li>
            <li>
              <Icon name="bell" size={16} /> Get a message when your room is ready
            </li>
            <li>
              <Icon name="key" size={16} /> Mobile key on the door and elevator
            </li>
            <li>
              <Icon name="wrench" size={16} /> Report a problem and follow the repair
            </li>
            <li>
              <Icon name="leaf" size={16} /> Set your room temperature
            </li>
            <li>
              <Icon name="calendar" size={16} /> Choose whether you need housekeeping tomorrow
            </li>
          </ul>
          <p style={{ marginTop: 18, fontSize: 13 }}>
            <a href={hotelUrl('/')} target={HOTEL_TAB}>
              Open the hotel view ↗
            </a>
          </p>
        </aside>
        <div className="gx-device">
          <div className={`gx-statusbar ${darkStatus ? 'dark' : ''}`} aria-hidden="true">
            <span className="num">{now !== undefined ? fmtTime(now).replace(/ (AM|PM)$/, '') : '9:41'}</span>
            <span className="notch" />
            <span className="row" style={{ gap: 5 }}>
              <Icon name="wifi" size={15} />
              <svg width="24" height="12" viewBox="0 0 24 12">
                <rect x="0.5" y="0.5" width="20" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.5" />
                <rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor" />
                <rect x="21.5" y="4" width="1.8" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
              </svg>
            </span>
          </div>
          {banners}
          <div className="gx-scroll">{children}</div>
          {tabs}
        </div>
      </div>
    </div>
  );
}
