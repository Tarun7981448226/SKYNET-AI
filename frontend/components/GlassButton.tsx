import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "danger" | "neutral";

const variantClass: Record<Variant, string> = {
  primary: "glass-button",
  danger: "glass-button glass-button--danger",
  neutral: "glass-button",
};

export function GlassButton({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`${variantClass[variant]} px-5 py-2.5 text-sm font-medium tracking-wide text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
