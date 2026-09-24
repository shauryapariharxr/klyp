/**
 * The klyp "K" mark, traced from the source logo artwork and snapped to a
 * 3x3 grid (viewBox 0 0 300 300, thirds at 0/100/200/300). Five solids:
 * a bevel-cut stem, the top-right bar, and two chevrons that pinch together
 * at the centre. It inherits `currentColor`, so drop it on any background.
 */
export default function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M0 0H100V100Z M0 100H100V300H0Z M200 0H300V100H200Z M100 100H300L200 200Z M100 200H300V300H200Z"
      />
    </svg>
  );
}
