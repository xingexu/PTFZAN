import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Logo';
import { Icon } from '../components/Icon';

/** The single public entrance for both guests and the hotel team. */
export default function Start() {
  useEffect(() => { document.title = 'Welcome · Founders Hotel Network'; }, []);
  return (
    <main className="hotel-start">
      <div className="backdrop" aria-hidden="true" />
      <header className="start-header"><Brand /><span>Toronto Downtown</span></header>
      <section className="start-content" aria-labelledby="start-title">
        <div className="start-intro">
          <span className="eyebrow">TORONTO, ONTARIO</span>
          <h1 id="start-title">Make yourself<br /><em>at home.</em></h1>
          <p>Your stay starts here.</p>
        </div>
        <nav className="start-choices" aria-label="Choose your access">
          <Link to="/guest" className="start-choice" viewTransition>
            <span className="start-choice-icon"><Icon name="key" size={24} /></span>
            <div className="start-choice-copy"><span className="eyebrow">STAYING WITH US</span><h2>Guest access</h2><p>Check in, open your room<br />and make yourself comfortable.</p><span className="start-choice-action">Enter your stay <Icon name="arrow" size={18} /></span></div>
          </Link>
          <Link to="/login" className="start-choice start-choice-team" viewTransition>
            <span className="start-choice-icon"><Icon name="building" size={24} /></span>
            <div className="start-choice-copy"><span className="eyebrow">WORKING WITH US</span><h2>Hotel team</h2><p>Rooms, housekeeping<br />and everything behind a good stay.</p><span className="start-choice-action">Sign in to the workspace <Icon name="arrow" size={18} /></span></div>
          </Link>
        </nav>
      </section>
      <footer className="start-footer"><span>Founders Hotel Network</span><span>Toronto Downtown</span></footer>
    </main>
  );
}
