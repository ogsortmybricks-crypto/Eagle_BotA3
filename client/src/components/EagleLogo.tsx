/** Default product branding; academy-specific logos take precedence. */
export function EagleLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/eagle-bot-logo.png"
      alt="Eagle Bot logo"
      width={128}
      height={128}
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
