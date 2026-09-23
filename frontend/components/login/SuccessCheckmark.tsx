/**
 * Apple-Pay-style self-drawing checkmark with a soft pulse ring behind it.
 * Pure CSS stroke-dasharray animation, no animation library needed.
 */
export function SuccessCheckmark({ label = "Verified" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="pulse-ring absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px var(--glow-primary)" }} />
        <svg viewBox="0 0 52 52" className="h-16 w-16">
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke="var(--glow-primary)"
            strokeWidth="2"
            className="checkmark-circle"
          />
          <path
            fill="none"
            stroke="#f2f4f8"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 27l7 7 17-17"
            className="checkmark-check"
          />
        </svg>
      </div>
      <p className="text-sm tracking-wide text-[var(--foreground)]/80">{label}</p>
      <style>{`
        .checkmark-circle {
          stroke-dasharray: 151;
          stroke-dashoffset: 151;
          animation: draw-circle 420ms ease-out forwards;
        }
        .checkmark-check {
          stroke-dasharray: 36;
          stroke-dashoffset: 36;
          animation: draw-check 300ms ease-out 380ms forwards;
        }
        .pulse-ring {
          opacity: 0.6;
          animation: pulse 900ms ease-out 200ms 1;
        }
        @keyframes draw-circle {
          to { stroke-dashoffset: 0; }
        }
        @keyframes draw-check {
          to { stroke-dashoffset: 0; }
        }
        @keyframes pulse {
          0% { transform: scale(0.8); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .checkmark-circle, .checkmark-check { animation: none; stroke-dashoffset: 0; }
          .pulse-ring { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
