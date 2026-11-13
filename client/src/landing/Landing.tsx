import './landing.css';

const SIGN_IN = '/api/auth/google';

/** A small picture of the product: a map with a route, and a boarding pass. Decorative. */
function Art() {
  return (
    <div className="landing-art" data-testid="landing-art" aria-hidden="true">
      <svg className="landing-art__map" viewBox="0 0 500 440" role="presentation" focusable="false">
        <rect width="500" height="440" rx="28" fill="var(--map-land)" />
        <path
          d="M410 0h90v440h-30c20-70 10-120-25-165-30-40-45-90-35-275z"
          fill="var(--map-water)"
        />
        <rect x="50" y="60" width="140" height="120" rx="14" fill="var(--map-park)" />
        <g fill="none" stroke="var(--map-road)" strokeWidth="13" strokeLinecap="round">
          <path d="M138 0v440" />
          <path d="M0 190h380" />
          <path d="M0 330h380" />
          <path d="M290 0v440" />
        </g>
        <path
          d="M85 395 332 340 215 262 155 185 250 120 345 165 395 50"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="landing-art__bubble">
        <span>Day 1 · Tokyo</span>
        <strong>Back at the hotel by 19:40</strong>
      </div>
      <div className="landing-art__pass">
        <div>
          <span className="landing-art__pass-label">Boarding pass · Japan</span>
          <span className="landing-art__pass-route">TLV ✈ HND</span>
        </div>
        <div className="landing-art__pass-count">
          <strong>41</strong>
          <span>days to go</span>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: 'Lay out your days',
    text: 'Create a trip, add days, and set where each day starts and ends.',
  },
  {
    title: 'Drop in places',
    text: 'Search restaurants, temples, bars. Set how long you like to stay at each kind of place.',
  },
  {
    title: 'Find my route',
    text: 'Junro tries every order and gives you the fastest one. Plans changed mid-day? It recalculates from where you stand.',
  },
];

/** What people see before they sign in. */
export function Landing() {
  return (
    <div className="landing">
      <header className="landing__header">
        <a className="landing__logo" href="/">
          junro <span lang="ja">順路</span>
        </a>
        <nav className="landing__nav" aria-label="Main">
          <a href="#how-it-works">How it works</a>
          <a className="button button--dark" href={SIGN_IN}>
            Sign in
          </a>
        </nav>
      </header>

      <main>
        <section className="landing__hero">
          <div className="landing__hero-text">
            <p className="landing__eyebrow">Trip planner · Free</p>
            <h1>
              Your trip, <br />
              in the right order.
            </h1>
            <p className="landing__lead">
              Add the places you are dreaming about. Junro finds the fastest way through each day,
              opening hours included, so you can spend the trip there and not on the map.
            </p>
            <div className="landing__actions">
              <a className="button button--accent" href={SIGN_IN}>
                Plan a trip
              </a>
              <a className="button button--outline" href="#how-it-works">
                See how it works
              </a>
            </div>
          </div>
          <Art />
        </section>

        <section className="landing__section landing__section--white" id="how-it-works">
          <h2>Three steps, then go.</h2>
          <ol className="landing__steps">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className={index === 2 ? 'landing__step landing__step--dark' : 'landing__step'}
              >
                <span className="landing__step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing__section landing__why">
          <p className="landing__big-jp" lang="ja" aria-hidden="true">
            順路 →
          </p>
          <div>
            <h2>Why junro?</h2>
            <p>
              In Japanese museums, a small sign reading <span lang="ja">順路</span> (junro) points
              the way to the next room, so you see everything in the right order without thinking
              about it. That is the whole idea.
            </p>
          </div>
        </section>

        <section className="landing__cta">
          <h2>Takeoff is closer than you think.</h2>
          <a className="button button--accent" href={SIGN_IN}>
            Plan a trip
          </a>
        </section>
      </main>
    </div>
  );
}
