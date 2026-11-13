/**
 * A soft golden-hour travel scene behind the page: sky, sun, clouds, a snow-capped mountain,
 * layered hills with a torii gate, birds, map contour lines, and a dotted route with pins and a
 * paper plane. Pure decoration, kept light so the text on top keeps its contrast.
 */
export function TravelBackdrop() {
  return (
    <div className="travel-backdrop" aria-hidden="true">
      <svg viewBox="0 0 800 1200" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="backdrop-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky-top)" />
            <stop offset="0.45" stopColor="var(--ground)" />
            <stop offset="1" stopColor="var(--sky-warm)" />
          </linearGradient>
        </defs>
        <rect width="800" height="1200" fill="url(#backdrop-sky)" />

        {/* The sun, low on the horizon */}
        <circle cx="620" cy="800" r="230" fill="var(--accent)" opacity="0.08" />
        <circle cx="620" cy="800" r="150" fill="var(--accent)" opacity="0.18" />
        <circle cx="620" cy="800" r="84" fill="var(--accent)" opacity="0.5" />

        {/* Clouds */}
        <g fill="var(--surface)" opacity="0.85">
          <ellipse cx="170" cy="170" rx="90" ry="26" />
          <ellipse cx="230" cy="150" rx="60" ry="26" />
          <ellipse cx="560" cy="250" rx="110" ry="28" />
          <ellipse cx="620" cy="228" rx="64" ry="26" />
          <ellipse cx="90" cy="420" rx="70" ry="20" />
        </g>

        {/* Birds */}
        <g fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" opacity="0.35">
          <path d="M330 120c10-14 22-14 30 0 8-14 20-14 30 0" />
          <path d="M440 190c8-11 17-11 24 0 7-11 16-11 24 0" />
          <path d="M270 260c7-9 15-9 21 0 6-9 14-9 21 0" />
        </g>

        {/* A mountain with snow on top */}
        <path
          d="M-80 930C90 800 230 620 310 540L420 540C500 620 640 800 880 930Z"
          fill="var(--map-water)"
          opacity="0.7"
        />
        <path
          d="M310 540 420 540 440 568c-14-6-22 8-36-6-10 16-22 0-36 14-12-14-24 4-36-8-14 10-24-4-32 4z"
          fill="var(--surface)"
          opacity="0.95"
        />

        {/* Map contour lines */}
        <g fill="none" stroke="var(--line)" strokeWidth="2" opacity="0.6">
          <path d="M-40 560c120-60 220 40 340-10s190-90 330-30 160 20 190-10" />
          <path d="M-40 630c130-50 230 50 350 0s180-80 320-20 160 10 200-20" />
        </g>

        {/* Hills, layered, with a torii gate */}
        <path
          d="M-20 1010c120-90 230-130 330-90s190 20 290-60 190-70 220-30v370H-20z"
          fill="var(--map-park)"
          opacity="0.7"
        />
        <g fill="none" stroke="var(--warning)" strokeWidth="7" strokeLinecap="round" opacity="0.55">
          <path d="M545 880V820M605 880V820" />
          <path d="M530 826h90M538 806h74" />
        </g>
        <path
          d="M-20 1110c150-70 260-80 360-40s200 20 300-30 150-30 180-10v170H-20z"
          fill="var(--map-water)"
          opacity="0.6"
        />

        {/* The route: dotted line, pins and a paper plane at the end */}
        <path
          d="M-20 720C120 660 170 780 300 720s210-190 350-130 150-10 190-60"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="1 15"
        />
        <g fill="var(--ink)" opacity="0.75">
          <circle cx="110" cy="702" r="9" />
          <circle cx="300" cy="720" r="9" />
          <circle cx="520" cy="610" r="9" />
        </g>
        <g fill="var(--surface)" opacity="0.95" transform="translate(690 540) rotate(-18)">
          <path d="M0 0 58 22 14 30 0 0zM14 30 58 22 26 52z" />
        </g>
      </svg>
    </div>
  );
}
