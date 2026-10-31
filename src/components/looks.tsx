"use client";

import { useState } from "react";
import type { Look } from "@/lib/looks";
import type { ColorProfile } from "@/lib/season";
import { readApiResult, networkFailure } from "@/lib/api-response";
import { Section, SectionHeading, Swatch, Callout, Disclosure, PrimaryButton } from "./ui";

interface RenderState {
  status: "idle" | "loading" | "done" | "error";
  imageUrl?: string;
  message?: string;
  guidance?: string;
}

/**
 * The three generated looks.
 *
 * Two things are shown for each: the colours we computed and why, and the actual
 * render from the YouCam makeup engine. The provenance line under each swatch is
 * the point — it shows the colour was derived from a measurement rather than
 * picked from a preset.
 *
 * The effect rationales and the exact request payload move into disclosures, so
 * the panel leads with the colours and the render.
 */
export function LookGallery({
  looks,
  profile,
  ticket,
  recordedSampleId,
  apiConfigured,
}: {
  looks: Look[];
  profile: ColorProfile;
  /**
   * Signed render ticket issued by the analyse route. It carries the measurement
   * and the true photo reference, so the client never posts either and cannot
   * forge provenance. Null when signing is not configured (recorded path only).
   */
  ticket: string | null;
  /**
   * Set only for the recorded demonstration. It lets the route render the
   * recorded sample's OWN photo when no ticket was issued (ticket signing is
   * optional). It can never select an arbitrary face.
   */
  recordedSampleId?: string;
  apiConfigured: boolean;
}) {
  const [active, setActive] = useState(0);
  const [renders, setRenders] = useState<Record<string, RenderState>>({});
  const look = looks[active];

  async function render(id: string) {
    setRenders((r) => ({ ...r, [id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookId: id, ticket: ticket ?? undefined, recordedSampleId }),
      });
      const data = await readApiResult<{ ok: true; imageUrl: string }>(res);
      if (data.ok) {
        setRenders((r) => ({ ...r, [id]: { status: "done", imageUrl: data.imageUrl } }));
      } else {
        setRenders((r) => ({
          ...r,
          [id]: { status: "error", message: data.title, guidance: data.guidance },
        }));
      }
    } catch {
      setRenders((r) => ({
        ...r,
        [id]: { status: "error", message: networkFailure("render").title },
      }));
    }
  }

  const state = renders[look.id] ?? { status: "idle" as const };

  return (
    <Section>
      <SectionHeading
        eyebrow="Step 03 — created"
        title="Looks made from your colours"
        note="Not picked from a preset list. Each colour is transformed from your measured features or palette."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Looks">
        {looks.map((l, i) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`min-h-11 rounded-full border px-4 py-2 text-left text-sm transition-colors ${
              i === active
                ? "border-blush-400/60 bg-blush-500/15 text-blush-200"
                : "border-ink-700 bg-ink-850 text-haze-200 hover:border-ink-600"
            }`}
          >
            <span className="block font-semibold">{l.name}</span>
            <span className="block text-xs text-haze-400">{l.occasion}</span>
          </button>
        ))}
      </div>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-haze-200">{look.description}</p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {look.colors.map((c, i) => (
          <li key={`${c.hex}-${i}`}>
            <Swatch hex={c.hex} label={c.hex} sublabel={c.derivedFrom} size="md" />
            <p className="mt-1 text-[11px] leading-snug text-haze-400">{c.transform}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-haze-100">Render on your photo</h3>
        <p className="mt-1 text-xs leading-relaxed text-haze-300">
          The YouCam makeup virtual try-on endpoint, 1 unit per successful render. A failed render is
          not charged.
        </p>

        {!apiConfigured ? (
          <div className="mt-3">
            <Callout tone="warn" title="Rendering needs an API key">
              Set <code className="font-mono">YOUCAM_API_KEY</code> on the server to render looks. The
              colour analysis and shade matching above work without it.
            </Callout>
          </div>
        ) : (
          <PrimaryButton onClick={() => render(look.id)} disabled={state.status === "loading"} className="mt-3">
            {state.status === "loading" ? "Rendering…" : `Render the ${look.name} look`}
          </PrimaryButton>
        )}

        <div className="mt-3">
          {state.status === "done" && state.imageUrl ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.imageUrl}
                alt={`The ${look.name} look rendered by the YouCam makeup engine`}
                className="w-full rounded-2xl border border-ink-700"
              />
              <figcaption className="mt-2 text-xs text-haze-300">
                Rendered live by the YouCam makeup virtual try-on API. The image URL is temporary.
              </figcaption>
            </figure>
          ) : null}
          {state.status === "error" ? (
            <Callout tone="alert" title={state.message ?? "Render failed"}>
              {state.guidance ?? "Try again."}
            </Callout>
          ) : null}
          {state.status === "idle" && apiConfigured ? (
            <p className="text-xs text-haze-400">No render yet for this look.</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Disclosure summary="What gets applied, and why" hint={`${look.effects.length} effects, each with its rationale.`}>
          <ul className="space-y-2">
            {look.effects.map((e) => (
              <li key={e.category} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-haze-200">{e.category}</span>
                  {e.color ? (
                    <span
                      className="swatch inline-block h-3 w-3 rounded-full align-middle"
                      style={{ backgroundColor: e.color.hex }}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-haze-300">{e.rationale}</p>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure summary="The exact request sent to the makeup engine" hint="For checking against the YouCam documentation.">
          <p className="text-xs leading-relaxed text-haze-300">
            Palette counts match the pattern&rsquo;s expected colour count, which the engine enforces.
          </p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-haze-200">
            {JSON.stringify(
              { version: "1.0", effects: look.effects.map((e) => e.payload) },
              null,
              2,
            )}
          </pre>
        </Disclosure>
      </div>

      <p className="mt-3 text-xs text-haze-400">
        Generated for {profile.season.name}. The three looks differ in depth and intensity so you can
        compare, rather than being three variations of the same idea.
      </p>
    </Section>
  );
}
