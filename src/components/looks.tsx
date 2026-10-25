"use client";

import { useState } from "react";
import type { Look } from "@/lib/looks";
import type { ColorProfile } from "@/lib/season";
import type { DataSource, PipelineSuccess } from "@/lib/pipeline";
import { Panel, SectionHeading, Swatch, Badge, Callout } from "./ui";

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
 */
export function LookGallery({
  looks,
  profile,
  imageUrl,
  measured,
  quality,
  source,
  sourceRef,
  apiConfigured,
}: {
  looks: Look[];
  profile: ColorProfile;
  imageUrl?: string;
  measured?: PipelineSuccess["measured"];
  quality?: PipelineSuccess["quality"];
  source?: DataSource;
  sourceRef?: PipelineSuccess["sourceRef"];
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
        body: JSON.stringify({ lookId: id, imageUrl, measured, quality, source, sourceRef }),
      });
      const data = await res.json();
      if (data.ok) {
        setRenders((r) => ({ ...r, [id]: { status: "done", imageUrl: data.imageUrl } }));
      } else {
        setRenders((r) => ({
          ...r,
          [id]: { status: "error", message: data.title ?? "Render failed", guidance: data.guidance },
        }));
      }
    } catch {
      setRenders((r) => ({
        ...r,
        [id]: { status: "error", message: "Could not reach the render endpoint" },
      }));
    }
  }

  const state = renders[look.id] ?? { status: "idle" as const };

  return (
    <Panel className="p-5">
      <SectionHeading
        eyebrow="Step 3 — generated"
        title="Makeup looks computed from your measurements"
        note="Nothing here is picked from a preset list. Each colour is transformed from your measured features or your palette, and the transformation is printed under the swatch."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Looks">
        {looks.map((l, i) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              i === active
                ? "border-signal-500/50 bg-signal-500/15 text-signal-300"
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

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h4 className="text-sm font-semibold text-haze-100">What gets applied, and why</h4>
          <ul className="mt-2 space-y-2">
            {look.effects.map((e) => (
              <li key={e.category} className="rounded border border-ink-700 bg-ink-850 p-2.5">
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
        </div>

        <div>
          <h4 className="text-sm font-semibold text-haze-100">Render on the photo</h4>
          <p className="mt-1 text-xs leading-relaxed text-haze-300">
            This calls the YouCam makeup virtual try-on endpoint, which costs 1 unit per successful
            render. A failed render is not charged.
          </p>

          {!apiConfigured ? (
            <div className="mt-3">
              <Callout tone="warn" title="Rendering needs an API key">
                Set <code className="font-mono">YOUCAM_API_KEY</code> on the server to render looks.
                The colour analysis and shade matching above work without it.
              </Callout>
            </div>
          ) : (
            <button
              onClick={() => render(look.id)}
              disabled={state.status === "loading"}
              className="mt-3 rounded-lg border border-signal-500/50 bg-signal-500/15 px-4 py-2 text-sm font-semibold text-signal-300 disabled:opacity-50"
            >
              {state.status === "loading" ? "Rendering…" : `Render the ${look.name} look`}
            </button>
          )}

          <div className="mt-3">
            {state.status === "done" && state.imageUrl ? (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.imageUrl}
                  alt={`The ${look.name} look rendered by the YouCam makeup engine`}
                  className="w-full rounded-lg border border-ink-700"
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
      </div>

      <details className="mt-5 rounded-lg border border-ink-700 bg-ink-850 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-haze-100">
          The exact request sent to the makeup engine
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-haze-300">
          Shown so the payload can be checked against the YouCam documentation. Palette counts match
          the pattern&rsquo;s expected colour count, which the engine enforces.
        </p>
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-haze-200">
          {JSON.stringify(
            { version: "1.0", effects: look.effects.map((e) => e.payload) },
            null,
            2,
          )}
        </pre>
      </details>

      <p className="mt-3 text-xs text-haze-400">
        Generated for {profile.season.name}. The three looks differ in depth and intensity so you can
        compare, rather than being three variations of the same idea.
      </p>
    </Panel>
  );
}
