"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-500",
  secondary:
    "border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800",
  ghost: "text-neutral-400 hover:text-neutral-100",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <button
      className={`${base} ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function TextArea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-neutral-300">{label}</span>
      {children}
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || action);
  return (
    <section
      className={`rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 ${className}`}
    >
      {hasHeader ? (
        <header className="mb-4 flex items-center justify-between gap-4">
          {title !== undefined ? (
            <h2 className="font-semibold text-neutral-100">{title}</h2>
          ) : null}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export type BadgeTone = "green" | "red" | "amber" | "gray" | "blue";

const badgeTones: Record<BadgeTone, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  red: "border-red-500/30 bg-red-500/10 text-red-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  gray: "border-neutral-500/30 bg-neutral-500/10 text-neutral-400",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-400",
};

export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500"
      role="status"
    >
      <svg
        className="h-5 w-5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      {label ? <span>{label}</span> : null}
    </div>
  );
}