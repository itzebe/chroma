"use client";

import { readableTextOn } from "@/lib/products";

/* ---------------------------------------------------------------------------
 * CHROMA brand primitives.
 *
 * Every component here is presentation only: none of them know about the
 * analysis, the API or the security model. That keeps the redesign a redesign,
 * and keeps the product logic where it was.
 * ------------------------------------------------------------------------- */

/**
 * The brand mark. A wordmark set in the display face beside a single solid
 * blush dot - the accent is the measured-rose colour the product works in.
 */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const text = size === "sm" ? "text-sm" : "text-base";
  return (
    <span className="inline-flex items-baseline gap-2.5">
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 translate-y-[-1px] rounded-full bg-blush-400" />
      <span className={`wordmark ${text} text-haze-100`}>Chroma</span>
    </span>
  );
}

export function Panel({
  children,
  className = "",
  id,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag id={id} className={`panel rounded-2xl ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * An editorial section of results.
 *
 * Results are separated by a hairline rule and whitespace rather than boxed.
 * Boxing every block would flatten the hierarchy: the composer is a tool and
 * earns a container, whereas a run of measurements is content and reads better
 * on the page ground. The first section follows the composer directly, so
 * `.results > :first-child` in globals.css drops its rule.
 */
export function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`border-t border-ink-800 pt-8 sm:pt-10 ${className}`}>
      {children}
    </section>
  );
}

/**
 * Section heading. `note` is for the one line a user must read before acting;
 * anything longer belongs in a `Disclosure`.
 */
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
    <header className="mb-5">
      <p className="eyebrow text-blush-300">{eyebrow}</p>
      <h2 className="display mt-2 text-2xl font-medium text-haze-100 sm:text-[1.75rem]">{title}</h2>
      {note ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-haze-300">{note}</p> : null}
    </header>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "recorded" | "warn" | "alert" | "good" | "brand";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-700/70 text-haze-200 border-ink-600",
    brand: "bg-blush-500/12 text-blush-200 border-blush-500/40",
    live: "bg-signal-500/15 text-signal-300 border-signal-500/40",
    recorded: "bg-gold-400/15 text-gold-300 border-gold-400/40",
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
        className={`swatch ${dims} flex w-full items-end rounded-xl p-2`}
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
          className={`h-full rounded-full ${highlight ? "bg-blush-400" : "bg-ink-600"}`}
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
    <div className={`rounded-xl border p-3.5 ${tones[tone]}`}>
      <p className={`text-sm font-semibold ${titleTone[tone]}`}>{title}</p>
      <div className="mt-1 text-sm leading-relaxed text-haze-200">{children}</div>
    </div>
  );
}

/**
 * Progressive disclosure. A native <details> so it is keyboard operable, works
 * with touch, and survives with JavaScript disabled. Long explanations live
 * here rather than in the main reading path.
 */
export function Disclosure({
  summary,
  hint,
  children,
  className = "",
}: {
  summary: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={`disclosure group rounded-xl border border-ink-700 bg-ink-850 ${className}`}>
      <summary className="px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-haze-100">{summary}</span>
          {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-haze-400">{hint}</span> : null}
        </span>
        <svg
          className="disclosure-chevron h-4 w-4 shrink-0 text-haze-400"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 6.25 8 10.25l4.5-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="border-t border-ink-700 px-4 py-3.5">{children}</div>
    </details>
  );
}

/** The primary action. One per view, and the only filled control. */
export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-blush-300 px-6 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-blush-200 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-haze-400 ${className}`}
    >
      {children}
    </button>
  );
}

/** The secondary action: outlined, never competing with the primary. */
export function GhostButton({
  children,
  onClick,
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-5 py-3 text-sm font-medium text-haze-100 transition-colors hover:border-haze-500 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A segmented control for a two-way choice (recorded vs live).
 * `role="radiogroup"` rather than tabs: the two options are alternatives, and the
 * selected one is announced.
 */
export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-full border border-ink-700 bg-ink-850 p-1"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`min-h-9 rounded-full px-4 text-sm font-medium transition-colors ${
              selected ? "bg-blush-300 text-ink-950" : "text-haze-200 hover:text-haze-100"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
