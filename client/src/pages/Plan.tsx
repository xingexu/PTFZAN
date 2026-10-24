import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

/** Five-dot score, 5 = most favourable for going first. */
function Score({ n }: { n: number }) {
  return (
    <span className="score" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

const CHALLENGES: { name: string; exposure: string; data: string; test: string; guest: string; scores: number[]; verdict: ReactNode; pick?: boolean }[] = [
  {
    name: 'Housekeeping & room readiness',
    exposure: '38 vs 30-min clean goal; 1 in 8 arrivals wait past 3 PM',
    data: 'Room status + assignments exist; updates arrive late',
    test: 'One property or floor; readiness and check-in delay measured directly in weeks',
    guest: 'Direct — “can I get into my room?”',
    scores: [5, 5, 4],
    verdict: <span className="pill ai">Start here</span>,
    pick: true,
  },
  {
    name: 'Labour allocation & scheduling',
    exposure: '$119M labour; overtime ≈ 7% of hours',
    data: 'Reservations, occupancy, schedules',
    test: 'Needs several scheduling cycles and employee participation',
    guest: 'Indirect — service speed',
    scores: [3, 2, 4],
    verdict: <span className="pill violet">Phase 2 · same data</span>,
  },
  {
    name: 'Maintenance & downtime',
    exposure: '2,100 lost room-nights (~$340K); emergency repairs ≈ 3× planned',
    data: 'Spreadsheets with inconsistent wording',
    test: 'Failures too rare for a short pilot',
    guest: 'Disruptive, but less frequent',
    scores: [3, 2, 2],
    verdict: <span className="pill amber">Phase 2 · fix records first</span>,
  },
  {
    name: 'Energy & resource efficiency',
    exposure: '$17.5M energy; 25% emissions cut by 2030',
    data: 'Only 9 of 42 hotels have smart thermostats',
    test: 'Weather and occupancy confound results',
    guest: 'Comfort risk if done blindly',
    scores: [2, 3, 2],
    verdict: <span className="pill teal">Phase 3 · 9 hotels</span>,
  },
];

const PILLARS: { icon: IconName; tone: string; title: string; decision: string; data: string; ai: string; distinct: string }[] = [
  {
    icon: 'bed',
    tone: 'ai',
    title: 'Room readiness — the priority',
    decision: 'Which room is cleaned next, and what do we tell the guest at the desk?',
    data: 'Checkouts, late checkouts, arrivals and group bookings from the booking system; one-tap room status; cleaning times by room type; open repairs; staff on shift.',
    ai: 'Gives every room a ready-time window; reorders the attendants’ lists around checkouts, elevator problems and group arrivals; writes the guest update.',
    distinct: 'Not a chatbot — a forecast the whole hotel shares. Guests get a promise we keep (the late end of the range).',
  },
  {
    icon: 'users',
    tone: 'violet',
    title: 'Labour',
    decision: 'Who covers a sick call today — and how many attendants tomorrow?',
    data: 'Rooms still to clean and how long each type takes; tomorrow’s checkouts and staying guests from the booking system; guests who skip cleaning in the app.',
    ai: 'At 8:00 on Oct 16 it sees three attendants can’t finish the day and books the backup attendant — today that shortfall surfaced at 3:45 and pulled a supervisor and houseperson off their jobs. For tomorrow it recommends a floater instead of overtime.',
    distinct: 'Room-based, never person-based — the union’s red line is designed in.',
  },
  {
    icon: 'wrench',
    tone: 'amber',
    title: 'Maintenance',
    decision: 'Who owns this fault, when will it be fixed, and is it a repeat?',
    data: 'Guest and staff reports, plus the typed repair notes FHN already keeps.',
    ai: 'AI reads messy notes (“rm 411 ac not cold”) into what · where · problem, so repeats trigger a planned repair; every report becomes one request with a named owner and a time.',
    distinct: 'Uses the records FHN has today — no sensors needed to start.',
  },
  {
    icon: 'leaf',
    tone: 'teal',
    title: 'Energy',
    decision: 'Should this empty room be heating or cooling right now?',
    data: 'Room state and readiness forecast, guest “heading back” taps, smart thermostats at 9 hotels.',
    ai: 'Turns empty rooms to energy saver and brings them back 20 minutes before someone is expected to walk in.',
    distinct: 'Fixes the Riley T. problem: savings without a warm room on return.',
  },
];

const PHASES: { when: string; title: string; items: string[]; cost: number; color: string }[] = [
  {
    when: 'Weeks 0–6',
    title: 'Agree & connect',
    items: ['Union signs off on exactly what is recorded', 'Connect to the booking system at Toronto Downtown (read only)', 'Attendant one-tap app, 30-min training'],
    cost: 60,
    color: '#98A2B3',
  },
  {
    when: 'Months 2–4 · short term',
    title: 'Pilot: room readiness',
    items: ['Toronto Downtown (the Oct 16 hotel)', 'Ready times, cleaning order and guest texts', 'Go/no-go: hit 2 of 3 success measures'],
    cost: 140,
    color: '#3B5BDB',
  },
  {
    when: 'Months 5–9',
    title: 'Scale + labour & maintenance',
    items: ['10 more full-service hotels, then select-service', 'Staffing forecast on the same data', 'Read all 42 hotels’ repair notes'],
    cost: 160,
    color: '#7A5AF8',
  },
  {
    when: 'Months 9–12 · long term',
    title: 'Energy at 9 hotels',
    items: ['Energy saver in empty rooms where smart thermostats exist', 'Measured fairly, adjusting for the weather', 'Year 2: a model per hotel type; sensors on equipment that keeps failing'],
    cost: 70,
    color: '#0E9384',
  },
];

export default function Plan() {
  const total = PHASES.reduce((n, p) => n + p.cost, 0);
  const reserve = 500 - total;
  return (
    <main className="page plan">
      <section className="plan-hero">
        <span className="eyebrow">Recommendation to Maya Patel, COO</span>
        <h1>Fix room readiness first. Then let the same live room data fix staffing, repairs and energy.</h1>
        <div className="hero-stats">
          <div>
            <b>1 in 8 → 1 in 16</b>
            <span>arrivals waiting past 3 PM</span>
          </div>
          <div>
            <b>$500K</b>
            <span>year-one budget, released in stages</span>
          </div>
          <div>
            <b>~$1.0M / yr</b>
            <span>hard savings at full rollout</span>
          </div>
          <div>
            <b>Full-service first</b>
            <span>front desk + housekeeping supervisors</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Why room readiness goes first</h2>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Challenge (Exhibit 1)</th>
                <th>What it costs</th>
                <th>Data today</th>
                <th>Ease of testing</th>
                <th>Guest impact</th>
                <th>Quick to prove · Guest impact · Data ready</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {CHALLENGES.map((c) => (
                <tr key={c.name} className={c.pick ? 'pick' : ''}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>{c.exposure}</td>
                  <td>{c.data}</td>
                  <td>{c.test}</td>
                  <td>{c.guest}</td>
                  <td>
                    <div className="stack" style={{ gap: 4 }}>
                      {c.scores.map((s, i) => (
                        <Score key={i} n={s} />
                      ))}
                    </div>
                  </td>
                  <td>{c.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
          <span className="pill ai">Full-service hotels first (11)</span>
          <span className="pill slate">Then select-service (24)</span>
          <span className="pill slate">Users: front desk &amp; housekeeping supervisors</span>
        </div>
      </section>

      <section className="section">
        <h2>How it works</h2>
        <div className="flow">
          <div className="card card-pad">
            <span className="pill slate">1 · Data it uses</span>
            <h3 style={{ marginTop: 8 }}>Signals FHN already has</h3>
            <ul>
              <li>Booking system: checkouts, late checkouts, arrivals, group bookings</li>
              <li>One-tap room status from attendants (start / done / issue)</li>
              <li>How long each <b>room type</b> usually takes to clean</li>
              <li>Repair requests and old repair notes</li>
              <li>Staff on shift; smart thermostats where installed</li>
            </ul>
          </div>
          <div className="arrow" aria-hidden="true">
            <Icon name="arrow" size={22} />
          </div>
          <div className="card card-pad" style={{ borderColor: 'var(--ai-line)', boxShadow: '0 0 0 1px var(--ai-line)' }}>
            <span className="ai-chip">
              <Icon name="sparkles" size={12} /> 2 · What the AI does
            </span>
            <h3 style={{ marginTop: 8 }}>Predict, re-plan, explain</h3>
            <ul>
              <li>
                <b>Ready-time forecast:</b> a time <i>window</i> for every room, wider when the day gets messier
              </li>
              <li>
                <b>Smart cleaning order:</b> who should clean which room next, around checkouts, deadlines and the elevator
              </li>
              <li>
                <b>Writing help:</b> plain-language messages to guests, and reading messy repair notes
              </li>
            </ul>
          </div>
          <div className="arrow" aria-hidden="true">
            <Icon name="arrow" size={22} />
          </div>
          <div className="card card-pad">
            <span className="pill green">3 · Outputs</span>
            <h3 style={{ marginTop: 8 }}>One shared answer</h3>
            <ul>
              <li>Front desk: the same ready time on every screen, with “why”</li>
              <li>Supervisor: proposed plan + one-tap approval</li>
              <li>Attendants: next room is always actually empty</li>
              <li>Guests: an honest ready time, then “your room is ready” — with consent</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Same data, four wins</h2>
        <div className="pgrid">
          {PILLARS.map((p) => (
            <div className="card card-pad" key={p.title}>
              <div className="row">
                <span className={`pillar-icon tone-${p.tone}`}>
                  <Icon name={p.icon} size={17} />
                </span>
                <h3>{p.title}</h3>
              </div>
              <dl>
                <dt>Decision</dt>
                <dd>{p.decision}</dd>
                <dt>Data</dt>
                <dd>{p.data}</dd>
                <dt>AI</dt>
                <dd>{p.ai}</dd>
                <dt>Distinct</dt>
                <dd>{p.distinct}</dd>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Guardrails</h2>
        <div className="principles">
          <Principle icon="users" title="People decide" text="Small changes are automatic. Anything guests see needs a supervisor." />
          <Principle icon="shield" title="Rooms, not people" text="No tracking, no speed scores. The union helps run the pilot." />
          <Principle icon="lock" title="Privacy built in" text="Texts only with consent. Meets Canada’s privacy law (PIPEDA)." />
          <Principle icon="clock" title="Honest time windows" text="Guests get a window and we promise its later end." />
        </div>
      </section>

      <section className="section">
        <h2>Roadmap &amp; the $500K</h2>
        <div className="phases">
          {PHASES.map((p) => (
            <div className="card phase" key={p.title}>
              <span className="when">{p.when}</span>
              <h3>{p.title}</h3>
              <ul>
                {p.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <span className="cost num" style={{ color: p.color }}>
                ${p.cost}K
              </span>
            </div>
          ))}
        </div>
        <div className="budget-bar" aria-hidden="true">
          {PHASES.map((p) => (
            <i key={p.title} style={{ width: `${(p.cost / 500) * 100}%`, background: p.color }} />
          ))}
          <i style={{ width: `${(reserve / 500) * 100}%`, background: 'var(--brass-hi)' }} />
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          ${total}K across four phases + <b>${reserve}K reserve</b> for change management, union-agreed training time and contingency = $500K.
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginTop: 28 }}>
        <section className="card">
          <div className="card-head">
            <div className="title">
              <Icon name="target" size={16} />
              <h2>Success measures (pilot gate)</h2>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Today</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Arrivals waiting past 3:00 PM</td>
                <td className="num">1 in 8 (12.5%)</td>
                <td className="num">&lt; 6%</td>
              </tr>
              <tr>
                <td>Rooms ready within the promised window</td>
                <td className="num">no time given</td>
                <td className="num">≥ 85%</td>
              </tr>
              <tr>
                <td>Housekeeping overtime hours (phase 2)</td>
                <td className="num">≈ 7% of hours</td>
                <td className="num">−25%</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-head">
            <div className="title">
              <Icon name="dollar" size={16} />
              <h2>Value case (annual, full rollout)</h2>
            </div>
          </div>
          <table className="table">
            <tbody>
              <tr>
                <td>Housekeeping capacity: 2 of the 8 extra minutes per clean × ~1,700 daily checkouts</td>
                <td className="num">
                  <b>$540K</b>
                  <div className="muted">redeployed, not cut</div>
                </td>
              </tr>
              <tr>
                <td>Overtime: −25% of housekeeping’s extra overtime pay (≈ $1.6M)</td>
                <td className="num">
                  <b>$400K</b>
                </td>
              </tr>
              <tr>
                <td>Repairs: shift 15% of emergency work (≈ $2.8M) to planned at ⅓ the cost; recover 20% of lost room-nights</td>
                <td className="num">
                  <b>$350K</b>
                </td>
              </tr>
              <tr>
                <td>Energy: 15–25% of guest-room heating and cooling at the 9 smart-thermostat hotels</td>
                <td className="num">
                  <b>$250K</b>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ padding: '0 14px 14px', margin: 0, fontSize: 12.5 }}>≈ $1.0M a year in hard savings against $500K + $120K a year to run — paid back in year two.</p>
        </section>
      </div>

      <section className="section">
        <h2>Risks &amp; mitigations</h2>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Union sees it as watching workers', 'Records rooms, never people; union helps run the pilot; written promise that time saved is reused, not cut.'],
                ['Some booking data updates only overnight', 'Attendant taps are the live source; pilot where bookings update live; check every few minutes elsewhere.'],
                ['A wrong ready time breaks trust', 'Time windows, promise the late end, supervisor approves anything guests see, must keep ≥85% of promises to continue.'],
                ['Guest privacy', 'Texts only with consent, collect only what is needed, data stored in Canada, guest data never used to train AI.'],
                ['Guests too warm or cold after energy saving', 'Never touch an occupied room; back to comfort 20 minutes ahead; guest can change it in one tap.'],
                ['Costs creep up, or we get stuck with a vendor', 'Works on top of existing systems, staged budget, $70K reserve, easy exit in the contract.'],
              ].map(([r, m]) => (
                <tr key={r}>
                  <td>
                    <b>{r}</b>
                  </td>
                  <td>{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Industry context</h2>
        <div className="principles">
          <Principle icon="chart" title="$30.0B, +4.1%" text="Canadian hotel revenue, 2024" />
          <Principle icon="trendDown" title="Costs +3.3%" text="Wages are 27.3% of hotel costs" />
          <Principle icon="phoneDevice" title="1 in 8 wait" text="FHN arrivals waiting past 3 PM" />
          <Principle icon="leaf" title="Emissions −25% by 2030" text="FHN’s own target" />
        </div>
      </section>

    </main>
  );
}

function Principle({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="card card-pad">
      <span className="pillar-icon tone-ai">
        <Icon name={icon} size={16} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
