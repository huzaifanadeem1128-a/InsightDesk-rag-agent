export function PrismSymbol() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="prismLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5c47d6" />
          <stop offset="100%" stopColor="#3f52c9" />
        </linearGradient>
        <linearGradient id="prismRight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c8cff" />
          <stop offset="100%" stopColor="#4b83ff" />
        </linearGradient>
        <linearGradient id="prismBeamIn" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="prismBeamOut" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c2a3ff" />
          <stop offset="50%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#5cc8ff" />
        </linearGradient>
        <radialGradient id="prismGlow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.55" />
          <stop offset="70%" stopColor="#7c5cff" stopOpacity="0" />
        </radialGradient>

        <symbol id="prism-symbol" viewBox="0 0 64 64">
          <circle cx="32" cy="34" r="26" fill="url(#prismGlow)" />
          <path
            d="M 0 32 L 22 32"
            stroke="url(#prismBeamIn)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M 32 14 L 22 46 L 32 46 Z" fill="url(#prismLeft)" />
          <path d="M 32 14 L 42 46 L 32 46 Z" fill="url(#prismRight)" />
          <path
            d="M 32 14 L 32 46"
            stroke="#ffffff"
            strokeOpacity="0.15"
            strokeWidth="0.6"
          />
          <path
            d="M 32 14 L 22 46"
            stroke="#c2b9ff"
            strokeOpacity="0.6"
            strokeWidth="0.7"
            fill="none"
          />
          <path
            d="M 42 32 L 64 28"
            stroke="url(#prismBeamOut)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M 42 32 L 64 32"
            stroke="url(#prismBeamOut)"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity="0.85"
          />
          <path
            d="M 42 32 L 64 36"
            stroke="url(#prismBeamOut)"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity="0.7"
          />
          <circle cx="22" cy="32" r="1.4" fill="#ffffff" opacity="0.9" />
          <circle cx="42" cy="32" r="1.6" fill="#ffffff" opacity="0.9" />
        </symbol>
      </defs>
    </svg>
  );
}
