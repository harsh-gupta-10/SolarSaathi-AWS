export function RoofIllustration() {
  return (
    <figure className="roof-illustration samara-blueprint-card">
      <div className="blueprint-meta-bar">
        <div className="blueprint-tag">
          <span className="blueprint-pulse" aria-hidden="true" />
          <span>ARCHITECTURAL MODEL • 1:50</span>
        </div>
        <div className="blueprint-coords" aria-hidden="true">
          <span>LAT 28.6139° N</span>
          <span className="coord-divider">•</span>
          <span>TILT 18° S</span>
        </div>
      </div>
      <svg
        viewBox="0 0 560 440"
        role="img"
        aria-labelledby="roof-sketch-title roof-sketch-description"
        className="blueprint-svg"
      >
        <title id="roof-sketch-title">A roof plan that leaves room for life</title>
        <desc id="roof-sketch-description">
          An illustrative rooftop with a solar panel zone, a clear access path and open space. Not a property-specific layout or engineering assessment.
        </desc>
        <defs>
          <linearGradient id="warmSunGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff7d6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f5f2de" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="pvPanelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0d2338" />
            <stop offset="100%" stopColor="#1a3a5a" />
          </linearGradient>
          <linearGradient id="roofPlaneGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fdfdf7" />
            <stop offset="100%" stopColor="#f2eee0" />
          </linearGradient>
          <pattern id="blueprintGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e0ded6" strokeWidth="0.6" strokeDasharray="2 4" />
          </pattern>
        </defs>

        {/* Blueprint background grid */}
        <rect width="560" height="440" fill="url(#blueprintGrid)" />

        {/* Sun vector illumination rays */}
        <g opacity="0.45" stroke="#0096f7" strokeWidth="0.75" strokeDasharray="3 4">
          <line x1="480" y1="50" x2="280" y2="180" />
          <line x1="500" y1="70" x2="330" y2="210" />
          <line x1="450" y1="40" x2="220" y2="190" />
        </g>
        <circle cx="480" cy="50" r="26" fill="#fef9d9" stroke="#0096f7" strokeWidth="1" />
        <circle cx="480" cy="50" r="14" fill="#0096f7" opacity="0.15" />
        <text x="480" y="54" textAnchor="middle" fill="#0096f7" fontSize="10" fontFamily="var(--font-regola), monospace" fontWeight="600" letterSpacing="-0.2px">SUN 180°</text>

        {/* Building Foundation & Walls (Isometric) */}
        <path d="M70 240 L280 120 L490 238 L280 358 Z" fill="url(#roofPlaneGrad)" stroke="#666666" strokeWidth="1.2" />
        <path d="M70 240 L280 358 L280 392 L70 274 Z" fill="#e7e3e1" stroke="#666666" strokeWidth="1.2" />
        <path d="M280 358 L490 238 L490 272 L280 392 Z" fill="#d8d4d1" stroke="#666666" strokeWidth="1.2" />

        {/* Parapet Wall & Architectural Perimeter Offset */}
        <path d="M84 235 L280 128 L476 233 L280 344 Z" fill="none" stroke="#999999" strokeWidth="0.8" strokeDasharray="3 3" />

        {/* Clear Access / Service Path (1.0m Corridor) */}
        <path d="M225 198 L375 284" fill="none" stroke="#ffffff" strokeWidth="20" strokeLinecap="round" />
        <path d="M225 198 L375 284" fill="none" stroke="#0096f7" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />

        {/* Solar PV Array Zone — South Tilted Modules (Zone A) */}
        <g id="solar-pv-array">
          {/* Row 1 */}
          <path d="M106 240 L148 216 L178 233 L136 257 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M152 214 L194 190 L224 207 L182 231 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M198 188 L240 164 L270 181 L228 205 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          {/* Row 2 */}
          <path d="M142 261 L184 237 L214 254 L172 278 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M188 235 L230 211 L260 228 L218 252 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M234 209 L276 185 L306 202 L264 226 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          {/* Row 3 */}
          <path d="M178 282 L220 258 L250 275 L208 299 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M224 256 L266 232 L296 249 L254 273 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
          <path d="M270 230 L312 206 L342 223 L300 247 Z" fill="url(#pvPanelGrad)" stroke="#0096f7" strokeWidth="0.9" />
        </g>

        {/* Panel Busbar Precision Grid Details */}
        <g stroke="#ffffff" strokeWidth="0.4" opacity="0.6">
          <line x1="124" y1="230" x2="160" y2="249" />
          <line x1="170" y1="204" x2="206" y2="223" />
          <line x1="216" y1="178" x2="252" y2="197" />
          <line x1="160" y1="251" x2="196" y2="270" />
          <line x1="206" y1="225" x2="242" y2="244" />
          <line x1="252" y1="199" x2="288" y2="218" />
          <line x1="196" y1="272" x2="232" y2="291" />
          <line x1="242" y1="246" x2="278" y2="265" />
          <line x1="288" y1="220" x2="324" y2="239" />
        </g>

        {/* Zone B & C: Preserved Living Terrace & Greenery (Zone C) */}
        <g id="living-terrace">
          <path d="M296 195 L368 154 L448 200 L376 241 Z" fill="#e8ebe3" stroke="#999999" strokeWidth="0.8" />
          {/* Terrace Planters / Evergreen accents */}
          <rect x="382" y="174" width="48" height="12" rx="3" fill="#f5f2de" stroke="#666666" strokeWidth="0.75" transform="rotate(-26 382 174)" />
          <circle cx="370" cy="180" r="11" fill="#375033" opacity="0.85" />
          <circle cx="388" cy="190" r="13" fill="#375033" opacity="0.95" />
          <circle cx="410" cy="202" r="10" fill="#375033" opacity="0.8" />
          {/* Lounging shade pergola representation */}
          <line x1="324" y1="178" x2="324" y2="148" stroke="#666666" strokeWidth="1.2" />
          <line x1="362" y1="156" x2="362" y2="126" stroke="#666666" strokeWidth="1.2" />
          <line x1="390" y1="194" x2="390" y2="164" stroke="#666666" strokeWidth="1.2" />
          <line x1="324" y1="148" x2="362" y2="126" stroke="#999999" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="362" y1="126" x2="390" y2="164" stroke="#999999" strokeWidth="1" strokeDasharray="2 2" />
        </g>

        {/* Blueprint Callout Labels and Dimension Pointers */}
        <g fontFamily="var(--font-regola), system-ui, sans-serif" fontSize="12" fill="#000000">
          {/* Label 1: Solar Generation Zone */}
          <text x="32" y="162" fontWeight="500">Solar panel zone</text>
          <text x="32" y="178" fontSize="10" fill="#666666" letterSpacing="-0.2px">6.2 kWp • 9 high-efficiency modules</text>
          <path d="M128 168 L160 168 L170 196" fill="none" stroke="#0096f7" strokeWidth="1" />
          <circle cx="170" cy="196" r="2.5" fill="#0096f7" />

          {/* Label 2: Access Path */}
          <text x="340" y="324" fontWeight="500">Clear access path</text>
          <text x="340" y="340" fontSize="10" fill="#666666" letterSpacing="-0.2px">1.0m safety & maintenance clearance</text>
          <path d="M336 322 L310 322 L298 250" fill="none" stroke="#666666" strokeWidth="1" />
          <circle cx="298" cy="250" r="2.5" fill="#666666" />

          {/* Label 3: Room to rethink */}
          <text x="320" y="106" fontWeight="500">Room to rethink</text>
          <text x="320" y="122" fontSize="10" fill="#375033" letterSpacing="-0.2px">38 m² usable terrace space preserved</text>
          <path d="M345 128 L345 142 L356 166" fill="none" stroke="#375033" strokeWidth="1" />
          <circle cx="356" cy="166" r="2.5" fill="#375033" />
        </g>

        {/* Blueprint Dimension Ticks */}
        <g stroke="#999999" strokeWidth="0.75">
          <line x1="60" y1="250" x2="45" y2="242" />
          <line x1="270" y1="368" x2="255" y2="360" />
          <line x1="45" y1="242" x2="255" y2="360" strokeDasharray="3 3" />
          <text x="135" y="316" fill="#666666" fontSize="10" fontFamily="var(--font-regola), monospace" transform="rotate(27 135 316)">12.4m WIDTH</text>
        </g>
      </svg>
      <div className="blueprint-footer-specs">
        <div className="spec-item">
          <span className="spec-label">USABLE ROOF</span>
          <span className="spec-val">68 m²</span>
        </div>
        <div className="spec-divider" />
        <div className="spec-item">
          <span className="spec-label">EST. CAPACITY</span>
          <span className="spec-val">6.2 kWp</span>
        </div>
        <div className="spec-divider" />
        <div className="spec-item">
          <span className="spec-label">ANNUAL YIELD</span>
          <span className="spec-val">8,920 kWh</span>
        </div>
        <div className="spec-divider" />
        <div className="spec-item">
          <span className="spec-label">SAFETY CLEARANCE</span>
          <span className="spec-val">100% PRESERVED</span>
        </div>
      </div>
      <figcaption>Illustrative concept. Your roof still needs measurement and confirmation.</figcaption>
    </figure>
  );
}

