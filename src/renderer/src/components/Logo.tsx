export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="WA Premium Plus">
      <defs>
        <linearGradient id="wapp-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10B981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#wapp-logo-bg)" />
      <rect x="216" y="112" width="80" height="288" rx="40" fill="#FFFFFF" />
      <rect x="112" y="216" width="288" height="80" rx="40" fill="#FFFFFF" />
    </svg>
  );
}
