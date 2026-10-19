// GITG brand art: Matobo balancing rocks (granite "pills"), a gold sun and green hills.
// Pure shapes, no image file, so it is crisp at any size and costs nothing offline.

/** Wide scene for the top of Home. Sits on the forest band; the curve at the bottom meets the page. */
export function MatoboHero({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 390 176" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" className={className}>
      <circle cx="318" cy="54" r="30" className="fill-gold" />
      <rect x="0" y="128" width="390" height="30" rx="15" className="fill-sprout" />
      <rect x="0" y="146" width="390" height="30" className="fill-leaf" />
      <rect x="226" y="108" width="112" height="40" rx="20" className="fill-rock" />
      <rect x="240" y="76" width="82" height="36" rx="18" className="fill-rock-light" />
      <rect x="258" y="48" width="50" height="32" rx="16" className="fill-rock" />
      <rect x="266" y="24" width="32" height="28" rx="14" className="fill-rock-light" />
      <rect x="0" y="160" width="390" height="16" className="fill-ground" />
      <rect x="0" y="152" width="390" height="24" rx="12" className="fill-ground" />
    </svg>
  );
}

/** Small stack of rocks for the corner of a card or band. */
export function RockStack({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 120" aria-hidden="true" className={className}>
      <circle cx="112" cy="30" r="20" className="fill-gold" />
      <rect x="20" y="88" width="120" height="36" rx="18" className="fill-rock" />
      <rect x="36" y="60" width="84" height="32" rx="16" className="fill-rock-light" />
      <rect x="56" y="36" width="44" height="28" rx="14" className="fill-rock" />
    </svg>
  );
}

/** The GITG mark: a gold tile with a G. */
export function GitgMark({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-gold font-display font-extrabold tracking-tight text-on-gold"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      G
    </span>
  );
}
