"use client";

import { useState } from "react";
import type { ColorProfile } from "@/lib/season";
import { matchShades, type ProductCategory, type ShadeMatch } from "@/lib/products";
import { Section, SectionHeading, Badge, Callout, Disclosure } from "./ui";

const CATEGORIES: { id: ProductCategory; label: string; note: string }[] = [
  { id: "foundation", label: "Foundation", note: "Matched on your measured skin colour, weighting depth over hue." },
  { id: "lipstick", label: "Lipstick", note: "Matched on your measured lip colour." },
  { id: "blush", label: "Blush", note: "Matched on your measured lip colour." },
  { id: "eyeshadow", label: "Eyeshadow", note: "Matched on your measured eye colour." },
];

const GRADE_TONE: Record<ShadeMatch["grade"], "good" | "neutral" | "warn" | "alert"> = {
  excellent: "good",
  good: "neutral",
  close: "warn",
  poor: "alert",
};

/**
 * Shade matching.
 *
 * The library is generic on purpose: no third-party brand names or trademarked
 * shade names appear anywhere in this app, because the hackathon rules forbid
 * third-party trademarks in a submission.
 */
export function ShadeMatcher({ profile }: { profile: ColorProfile }) {
  const [category, setCategory] = useState<ProductCategory>("foundation");
  const matches = matchShades(category, profile, { limit: 6 });
  const active = CATEGORIES.find((c) => c.id === category)!;

  return (
    <Section>
      <SectionHeading
        eyebrow="Step 05 — shades"
        title="Shades that match your colouring"
        note="Each shade is scored against the colour actually measured on your face."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Product categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              category === c.id
                ? "border-blush-400/60 bg-blush-500/15 text-blush-200"
                : "border-ink-700 bg-ink-850 text-haze-200 hover:border-ink-600"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-haze-300">{active.note}</p>

      {matches.length === 0 ? (
        <div className="mt-4">
          <Callout tone="warn" title="No measurement for this category">
            Matching {active.label.toLowerCase()} needs the colour the API measures on that part of
            your face, and it was not returned for this photo. The ranking is withheld rather than
            guessed.
          </Callout>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((m, i) => (
            <li key={m.shade.id} className="rounded-2xl border border-ink-700 bg-ink-850 p-3.5">
              <div className="flex items-start gap-3">
                <div
                  className="swatch h-16 w-16 shrink-0 rounded-xl"
                  style={{ backgroundColor: m.shade.hex }}
                  role="img"
                  aria-label={`${m.shade.name}, colour ${m.shade.hex}`}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {i === 0 ? <Badge tone="brand">best match</Badge> : null}
                    <Badge tone={GRADE_TONE[m.grade]}>{m.grade}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-haze-100">{m.shade.name}</p>
                  <p className="font-mono text-xs text-haze-300">{m.shade.hex}</p>
                  {m.shade.finish ? (
                    <p className="text-xs text-haze-400">finish: {m.shade.finish}</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-blush-400"
                    style={{ width: `${Math.max(m.score, 2)}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[11px] text-haze-400">
                  match {m.score}/100 · ΔE {m.distance.toFixed(1)}
                </p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-haze-300">{m.direction}</p>
              {m.caution ? (
                <p className="mt-1.5 rounded-lg border border-warn-400/40 bg-warn-400/10 p-2 text-xs leading-relaxed text-warn-300">
                  {m.caution}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Disclosure
        className="mt-4"
        summary="About this shade library"
        hint="Why the names are descriptive rather than branded."
      >
        <p className="text-xs leading-relaxed text-haze-300">
          The shade library is a generic demonstration set with descriptive names. No third-party
          brand names or trademarked shade names are used.
        </p>
      </Disclosure>
    </Section>
  );
}
