"use client";
import clsx from "clsx";
import { forwardRef } from "react";
import { Spinner } from "./ui";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ink" | "stamp" | "line"; size?: "md" | "sm" | "icon"; loading?: boolean };

/** Mesh-gradient button. States: hover (gradient drifts), pressed (scales), focus ring, disabled, loading (shimmer + spinner). */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = "ink", size = "md", loading, disabled, className, children, ...rest }, ref) {
  return (
    <button ref={ref} {...rest} disabled={disabled || loading} data-loading={loading ? "true" : undefined} aria-busy={loading || undefined}
      className={clsx("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "icon" && "btn-icon", className)}>
      {loading && <Spinner className={clsx("h-4 w-4 border-2", variant === "line" ? "" : "border-white/30 border-t-white")} />}
      <span className="inline-flex items-center gap-2">{children}</span>
    </button>
  );
});
