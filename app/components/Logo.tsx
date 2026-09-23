export default function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  // Geometric "K" mark from the klyp logo, rebuilt as crisp SVG:
  // left stem with a wedge notch, right chevron arrows flowing in.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="klyp-accent" x1="64" y1="8" x2="24" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="0.55" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      {/* Stem: vertical bar + top wedge, with the notch carved out */}
      <path d="M14 13h14v13.5L14 13Zm0 9.5 14 12.2V51H14V22.5Z" fill="#f8fafc" />
      {/* Upper chevron */}
      <path d="M32 27.2 50 13v14.5L38 37.6 32 27.2Z" fill="url(#klyp-accent)" />
      {/* Lower chevron */}
      <path d="M36 51l14-11.5V51H36Z" fill="url(#klyp-accent)" />
    </svg>
  );
}
