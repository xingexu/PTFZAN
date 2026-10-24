export default function HowItWorks() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>How ReadyPath works</h1>
          <p>A thin readiness layer on top of FHN&rsquo;s existing property management system. No rip-and-replace.</p>
        </div>
      </div>

      <section className="flow" aria-label="Inputs, AI, outputs">
        <div className="card card-pad">
          <span className="pill slate">1 · Data it uses</span>
          <h2 style={{ marginTop: 8 }}>Existing signals</h2>
          <ul>
            <li>PMS: checkouts, late checkouts, arrivals, group blocks</li>
            <li>One-tap room status from attendants (start / done / issue)</li>
            <li>Historical clean time by <b>room type &amp; condition</b></li>
            <li>Maintenance tickets &amp; asset status (e.g. Elevator B)</li>
            <li>Staff on shift (from the schedule)</li>
          </ul>
        </div>
        <div className="arrow" aria-hidden="true">→</div>
        <div className="card card-pad" style={{ borderColor: 'var(--teal)', borderWidth: 2 }}>
          <span className="pill teal">2 · What the AI does</span>
          <h2 style={{ marginTop: 8 }}>Predict, then re-plan</h2>
          <ul>
            <li><b>Readiness forecast:</b> a ready-time <i>range</i> per room, with confidence that widens with queue depth and disruptions</li>
            <li><b>Constraint-aware sequencing:</b> re-orders work by need-by time, checkout availability and floor/elevator constraints</li>
            <li><b>Generative messaging:</b> turns the forecast into plain-language guest updates</li>
          </ul>
        </div>
        <div className="arrow" aria-hidden="true">→</div>
        <div className="card card-pad">
          <span className="pill green">3 · Outputs</span>
          <h2 style={{ marginTop: 8 }}>One shared answer</h2>
          <ul>
            <li>Front desk: same ETA on every screen</li>
            <li>Supervisor: proposed plan + one-tap approval</li>
            <li>Attendants: next room is always actually vacant</li>
            <li>Guests: realistic ETA, then &ldquo;your room is ready&rdquo;</li>
          </ul>
        </div>
      </section>

      <h2 style={{ margin: '26px 0 12px' }}>Guardrails</h2>
      <section className="principles">
        <div className="card card-pad">
          <h3>Human in the loop</h3>
          <p className="muted" style={{ margin: 0 }}>Routine re-plans apply automatically. Anything that changes a guest promise needs a supervisor&rsquo;s approval.</p>
        </div>
        <div className="card card-pad">
          <h3>Rooms, not people</h3>
          <p className="muted" style={{ margin: 0 }}>No individual speed data, tracking or leaderboards — a direct answer to the union&rsquo;s concerns.</p>
        </div>
        <div className="card card-pad">
          <h3>PIPEDA by design</h3>
          <p className="muted" style={{ margin: 0 }}>Texts only with consent. Guest portals see only their own booking. No guest personal data is used to train the model.</p>
        </div>
        <div className="card card-pad">
          <h3>Ranges, not promises</h3>
          <p className="muted" style={{ margin: 0 }}>We quote a window and promise the late end of it. Guests forgive delays; they don&rsquo;t forgive conflicting answers.</p>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginTop: 26 }}>
        <section className="card">
          <div className="card-head">
            <h2>Pilot &amp; rollout ($500K envelope)</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Scope</th>
                <th>Budget</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>1 · Months 0–3</b></td>
                <td>One full-service property. Read-only PMS integration, attendant app, rules-based forecast → ML once 60–90 days of data exist.</td>
                <td className="mono">~$180K</td>
              </tr>
              <tr>
                <td><b>Gate</b></td>
                <td>Continue only if 2 of 3 success measures are hit.</td>
                <td className="mono">—</td>
              </tr>
              <tr>
                <td><b>2 · Months 4–9</b></td>
                <td>Five more full-service properties; select-service next.</td>
                <td className="mono">~$170K</td>
              </tr>
              <tr>
                <td><b>Reserve</b></td>
                <td>Contingency + scoping labour forecasting on the same data.</td>
                <td className="mono">~$150K</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Success measures</h2>
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
                <td className="mono">1 in 8 (12.5%)</td>
                <td className="mono">&lt; 8%</td>
              </tr>
              <tr>
                <td>Rooms ready within the promised window</td>
                <td className="mono">no ETA given</td>
                <td className="mono">≥ 80%</td>
              </tr>
              <tr>
                <td>Readiness phone calls per shift</td>
                <td className="mono">baseline</td>
                <td className="mono">−50%</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ padding: '0 14px 14px', margin: 0, fontSize: 13 }}>
            Value case (conservative): recovering 2–3 of the 8 extra minutes per clean (38 vs 30-minute goal) ≈ $0.8–1.2M/yr of housekeeping capacity across ~3,000 daily cleans — redeployed, not cut. Guest-experience gains are counted as soft benefits.
          </p>
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2>About this prototype</h2>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          All data is simulated, as permitted by the case. The simulation replays the October 16 incident minute by minute with identical physical events in both modes. The forecast here uses
          learned room-type averages, queue simulation and an uncertainty band; in the pilot it becomes a model trained on room-level history. Ground-truth clean times are hidden from the
          forecaster, so the &ldquo;promises kept&rdquo; score is a genuine test, not a replay.
        </p>
      </section>
    </main>
  );
}
