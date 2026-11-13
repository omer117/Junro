/**
 * A soft background for the trips page: golden-hour sky, a few map contour lines, hills, a sun,
 * and a dotted route with pins and a paper plane. Pure decoration, kept light so the text on top
 * keeps its contrast.
 */
export function TravelBackdrop() {
  return (
    <div className="travel-backdrop" aria-hidden="true">
      <svg viewBox="0 0 800 1200" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="backdrop-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ground)" />
            <stop offset="0.55" stopColor="var(--ground)" />
            <stop offset="1" stopColor="var(--sky-warm)" />
          </linearGradient>
        </defs>
        <rect width="800" height="1200" fill="url(#backdrop-sky)" />

        {/* The sun, low on the horizon */}
        <circle cx="610" cy="860" r="190" fill="var(--accent)" opacity="0.1" />
        <circle cx="610" cy="860" r="120" fill="var(--accent)" opacity="0.22" />
        <circle cx="610" cy="860" r="64" fill="var(--accent)" opacity="0.5" />

        {/* Map contour lines */}
        <g fill="none" stroke="var(--line)" strokeWidth="2" opacity="0.7">
          <path d="M-40 260c120-60 220 40 340-10s190-90 330-30 160 20 190-10" />
          <path d="M-40 330c130-50 230 50 350 0s180-80 320-20 160 10 200-20" />
          <path d="M-40 400c120-40 240 60 360 10s170-70 310-10 160 0 210-30" />
          <path d="M-40 470c110-30 240 70 370 20s160-60 300 0 170-10 220-40" />
        </g>

        {/* Hills, layered */}
        <path
          d="M-20 1080c120-90 230-130 330-90s190 20 290-60 190-70 220-30v300H-20z"
          fill="var(--map-park)"
          opacity="0.55"
        />
        <path
          d="M-20 1140c150-70 260-80 360-40s200 20 300-30 150-30 180-10v140H-20z"
          fill="var(--map-water)"
          opacity="0.5"
        />

        {/* The route: dotted line, pins and a paper plane at the end */}
        <path
          d="M-20 700C120 640 170 760 300 700s210-190 350-130 150-10 190-60"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="1 15"
        />
        <g fill="var(--ink)" opacity="0.75">
          <circle cx="110" cy="682" r="9" />
          <circle cx="300" cy="700" r="9" />
          <circle cx="520" cy="590" r="9" />
        </g>
        <g fill="var(--surface)" opacity="0.95" transform="translate(690 520) rotate(-18)">
          <path d="M0 0 58 22 14 30 0 0zM14 30 58 22 26 52z" />
        </g>
      </svg>
    </div>
  );
}
