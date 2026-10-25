"use client";

import { useMemo, useState } from "react";
import type { ColorProfile } from "@/lib/season";
import { evaluateGarment, suggestPairings, nudgeTowardSeason, type GarmentVerdict } from "@/lib/garment";
import { Panel, SectionHeading, Swatch, Badge, Callout } from "./ui";

const SWATCHES = [
  { name: "Black", hex: "#111111" },
  { name: "White", hex: "#ffffff" },
  { name: "Camel", hex: "#c19a6b" },
  { name: "Navy", hex: "#1f3a5f" },
  { name: "Coral", hex: "#f4796b" },
  { name: "Olive", hex: "#6b7a2f" },
  { name: "Lilac", hex: "#b8a8d8" },
  { name: "Rust", hex: "#a0522d" },
  { name: "Emerald", hex: "#0f7a5a" },
  { name: "Hot pink", hex: "#e0447a" },
];

const VERDICT_TONE: Record<GarmentVerdict, "good" | "neutral" | "warn" | "alert"> = {
  excellent: "good",
  good: "neutral",
  workable: "warn",
  challenging: "alert",
};

const VERDICT_LABEL: Record<GarmentVerdict, string> = {
  excellent: "On your palette",
  good: "Easy to wear",
  workable: "Needs a pairing",
  challenging: "Keep away from your face",
};

/**
 * The eCommerce half: will this colour work on me?
 *
 * The verdict is deliberately four-valued. A yes/no answer would be dishonest,
 * because most colours are wearable with the right pairing, and the useful output
 * is the instruction rather than the grade.
 */
export function GarmentChecker({ profile }: { profile: ColorProfile }) {
  const [hex, setHex] = useState("#c19a6b");
  const [input, setInput] = useState("#c19a6b");

  const advice = useMemo(() => evaluateGarment(hex, profile), [hex, profile]);
  const pairings = useMemo(() => suggestPairings(hex, profile), [hex, profile]);
  const nudges = useMemo(() => nudgeTowardSeason(hex, profile, 4), [hex, profile]);

  function commit(value: string) {
    const clean = value.trim();
    if (/^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(clean)) {
      setHex(clean.startsWith("#") ? clean : `#${clean}`);
      setInput(clean.startsWith("#") ? clean : `#${clean}`);
    } else {
      setInput(value);
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeading
        eyebrow="Step 4 — shopping"
        title="Will this colour work on you?"
        note="Check any garment or product colour against your palette before you buy. The verdict is measured with CIEDE2000, the same perceptual distance the makeup generator uses."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <label htmlFor="garment-hex" className="text-sm font-medium text-haze-100">
            Colour to check
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="garment-hex"
              value={input}
              onChange={(e) => commit(e.target.value)}
              className="w-32 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-sm text-haze-100"
              placeholder="#c19a6b"
              aria-describedby="garment-hex-help"
            />
            <div
              className="swatch h-10 w-10 rounded-lg"
              style={{ backgroundColor: hex }}
              role="img"
              aria-label={`Selected colour ${hex}`}
            />
          </div>
          <p id="garment-hex-help" className="mt-1 text-xs text-haze-400">
            Type a hex value, or pick one of these common colours.
          </p>

          <ul className="mt-3 grid grid-cols-5 gap-2">
            {SWATCHES.map((s) => (
              <li key={s.hex}>
                <button
                  onClick={() => commit(s.hex)}
                  className={`swatch block h-10 w-full rounded-lg ${
                    hex.toLowerCase() === s.hex.toLowerCase() ? "ring-2 ring-signal-400" : ""
                  }`}
                  style={{ backgroundColor: s.hex }}
                  aria-label={`Check ${s.name}`}
                  title={s.name}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <h4 className="text-sm font-semibold text-haze-100">Your palette, for reference</h4>
            <ul className="mt-2 grid grid-cols-4 gap-2">
              {profile.season.palette.slice(0, 8).map((p) => (
                <li key={p.hex}>
                  <button
                    onClick={() => commit(p.hex)}
                    className="swatch block h-8 w-full rounded"
                    style={{ backgroundColor: p.hex }}
                    aria-label={`Check ${p.name}`}
                    title={p.name}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          {advice ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={VERDICT_TONE[advice.verdict]}>{VERDICT_LABEL[advice.verdict]}</Badge>
                <span className="font-mono text-xs text-haze-300">
                  ΔE {advice.distance.toFixed(1)} from &ldquo;{advice.nearest.name}&rdquo;
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold text-haze-100">{advice.headline}</h3>
              <p className="mt-2 text-sm leading-relaxed text-haze-200">{advice.detail}</p>
              <p className="mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm leading-relaxed text-haze-100">
                {advice.advice}
              </p>

              {advice.pairing ? (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-haze-100">Pair it with</h4>
                  <div className="mt-2 max-w-[10rem]">
                    <Swatch hex={advice.pairing.hex} label={advice.pairing.name} sublabel={advice.pairing.role} size="sm" />
                  </div>
                </div>
              ) : null}

              {pairings.pairs.length > 0 ? (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-haze-100">Other colours from your palette</h4>
                  <p className="mt-1 text-xs leading-relaxed text-haze-300">{pairings.reason}</p>
                  <ul className="mt-2 grid grid-cols-3 gap-2">
                    {pairings.pairs.map((p) => (
                      <li key={p.hex}>
                        <Swatch hex={p.hex} label={p.name} size="sm" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {advice.verdict !== "excellent" && nudges.length > 0 ? (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-haze-100">
                    If you want to buy something closer
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-haze-300">
                    A gradual walk from the colour you checked toward your nearest palette colour, so
                    you can see how small the change can be.
                  </p>
                  <ul className="mt-2 grid grid-cols-4 gap-2">
                    {nudges.map((n, i) => (
                      <li key={n}>
                        <Swatch hex={n} label={`step ${i + 1}`} size="sm" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <Callout tone="warn" title="That is not a valid colour">
              Enter a hex value such as <span className="font-mono">#c19a6b</span>.
            </Callout>
          )}
        </div>
      </div>
    </Panel>
  );
}
