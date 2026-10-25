"use client";

import { readableTextOn } from "@/lib/products";

export function Panel({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`panel rounded-xl ${className}`}>{children}</Tag>;
}

export function SectionHeading({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  note?: string;
}) {
  return (
    <header className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-haze-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-haze-100 sm:text-2xl">{title}</h2>
      {note ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-haze-300">{note}</p> : null}
    </header>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "recorded" | "warn" | "alert" | "good";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-700 text-haze-200 border-ink-600",
    live: "bg-signal-500/15 text-signal-300 border-signal-500/40",
    recorded: "bg-warn-400/15 text-warn-300 border-warn-400/40",
    warn: "bg-warn-400/15 text-warn-300 border-warn-400/40",
    alert: "bg-alert-400/15 text-alert-300 border-alert-400/40",
    good: "bg-signal-500/15 text-signal-300 border-signal-500/40",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A measured or generated colour.
 * The label uses a computed text colour so the contrast clears WCAG AA whatever
 * the swatch colour is.
 */
export function Swatch({
  hex,
  label,
  sublabel,
  size = "md",
}: {
  hex: string;
  label: string;
  sublabel?: string;
  size?: "sm" | "md" | "lg";
}) {
  const fg = readableTextOn(hex);
  const dims = { sm: "h-12", md: "h-20", lg: "h-28" }[size];
  return (
    <div className="flex flex-col">
      <div
        className={`swatch ${dims} flex w-full items-end rounded-lg p-2`}
        style={{ backgroundColor: hex }}
        role="img"
        aria-label={`${label}, colour ${hex}`}
      >
        <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ color: fg }}>
          {hex}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-haze-100">{label}</p>
      {sublabel ? <p className="text-xs text-haze-300">{sublabel}</p> : null}
    </div>
  );
}

/** Horizontal bar used for the dominance scores. */
export function Meter({
  label,
  value,
  detail,
  highlight = false,
}: {
  label: string;
  value: number;
  detail?: string;
  highlight?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm ${highlight ? "font-semibold text-haze-100" : "text-haze-200"}`}>
          {label}
        </span>
        <span className="font-mono text-xs text-haze-300">{value.toFixed(2)}</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-700"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full ${highlight ? "bg-signal-400" : "bg-ink-600"}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {detail ? <p className="mt-1 text-xs leading-relaxed text-haze-400">{detail}</p> : null}
    </div>
  );
}

export function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-700 py-2 last:border-0">
      <dt className="text-sm text-haze-300">{k}</dt>
      <dd className="text-right text-sm font-medium text-haze-100">{v}</dd>
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn" | "alert";
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-ink-600 bg-ink-850",
    warn: "border-warn-400/40 bg-warn-400/10",
    alert: "border-alert-400/40 bg-alert-400/10",
  };
  const titleTone = {
    neutral: "text-haze-100",
    warn: "text-warn-300",
    alert: "text-alert-300",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className={`text-sm font-semibold ${titleTone[tone]}`}>{title}</p>
      <div className="mt-1 text-sm leading-relaxed text-haze-200">{children}</div>
    </div>
  );
}
