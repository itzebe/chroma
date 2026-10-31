"use client";

import type { ColorProfile } from "@/lib/season";
import { Section, SectionHeading, Swatch, Meter, Badge, KeyValue, Callout, Disclosure } from "./ui";

const FEATURE_LABELS: Record<string, string> = {
  skin: "Skin",
  lip: "Lips",
  eye: "Eyes",
  eyebrow: "Brows",
  hair: "Hair",
};

/**
 * What the API actually measured, shown verbatim before any interpretation.
 * Keeping this above the seasonal verdict matters: the measured numbers are the
 * evidence, and the season is our reading of them.
 *
 * The L*C*h° coordinates and the quality flags move into a disclosure - they are
 * the audit trail, not the first thing a user needs.
 */
export function MeasuredColours({
  profile,
  quality,
}: {
  profile: ColorProfile;
  quality: { has_face?: boolean; area?: string | null; frontal?: string | null; lighting?: string | null; faceangle?: string | null };
}) {
  const qualityFlags = [
    { label: "Face found", value: quality.has_face ? "yes" : "no", ok: Boolean(quality.has_face) },
    { label: "Face size", value: quality.area ?? "unknown", ok: quality.area === "good" },
    { label: "Frontal", value: quality.frontal ?? "unknown", ok: quality.frontal === "good" },
    { label: "Lighting", value: quality.lighting ?? "unknown", ok: quality.lighting === "good" },
    { label: "Head pose", value: quality.faceangle ?? "unknown", ok: quality.faceangle === "good" || quality.faceangle === "normal" },
  ];

  return (
    <Section>
      <SectionHeading
        eyebrow="Step 01 — measured"
        title="Your colours, as measured"
        note="Straight from the YouCam skin tone analysis. Nothing adjusted, averaged or filled in."
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {profile.features.map((f) => (
          <li key={f.key}>
            <Swatch hex={f.hex} label={FEATURE_LABELS[f.key] ?? f.key} size="md" />
          </li>
        ))}
      </ul>

      {profile.missing.length > 0 ? (
        <div className="mt-4">
          <Callout tone="warn" title="Some features were not returned">
            The API did not return: {profile.missing.map((m) => FEATURE_LABELS[m] ?? m).join(", ")}. The
            profile is built from what was measured, and the missing features lower the confidence
            score rather than being estimated.
          </Callout>
        </div>
      ) : null}

      <Disclosure
        className="mt-4"
        summary="Measurement detail"
        hint="Colour coordinates and the photo-quality checks the API returned."
      >
        <ul className="space-y-2">
          {profile.features.map((f) => (
            <li key={f.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm text-haze-200">{FEATURE_LABELS[f.key] ?? f.key}</span>
              <span className="font-mono text-xs text-haze-300">
                {f.hex} · L* {f.lab.L.toFixed(1)} · chroma {f.lch.C.toFixed(1)} · hue{" "}
                {f.lch.h.toFixed(0)}°
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 border-t border-ink-700 pt-2">
          {qualityFlags.map((q) => (
            <KeyValue
              key={q.label}
              k={q.label}
              v={
                <span className={q.ok ? "text-signal-300" : "text-warn-300"}>
                  {q.value}
                  {!q.ok ? " — may affect accuracy" : ""}
                </span>
              }
            />
          ))}
        </dl>
      </Disclosure>
    </Section>
  );
}

/** The seasonal verdict. The reasoning moves behind a disclosure. */
export function SeasonProfile({ profile }: { profile: ColorProfile }) {
  const confidenceTone =
    profile.confidenceLabel === "high" ? "good" : profile.confidenceLabel === "moderate" ? "warn" : "alert";

  return (
    <Section>
      <SectionHeading
        eyebrow="Step 02 — interpreted"
        title="Your seasonal profile"
        note="A styling framework, not a measurement."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display text-3xl font-medium text-haze-100">{profile.season.name}</h3>
            <Badge tone="brand">{profile.season.family}</Badge>
            <Badge tone={confidenceTone}>confidence {profile.confidenceLabel}</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-haze-200">{profile.season.summary}</p>

          <dl className="mt-4">
            <KeyValue k="Undertone" v={profile.undertone.value} />
            <KeyValue k="Depth" v={profile.depth.value} />
            <KeyValue k="Clarity" v={profile.clarity.value} />
            <KeyValue k="Contrast" v={profile.contrast.value} />
            <KeyValue
              k="Confidence"
              v={<span className="font-mono">{(profile.confidence * 100).toFixed(0)}%</span>}
            />
          </dl>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-haze-100">What drove this result</h4>
          <p className="mt-1 text-xs leading-relaxed text-haze-300">
            Each axis is scored independently. The highest score picks the season family; the
            runners-up are shown so you can judge how clear-cut it was.
          </p>
          <ul className="mt-3 space-y-3">
            {profile.dominance.map((d, i) => (
              <li key={d.dominant}>
                <Meter label={d.dominant} value={d.score} detail={d.reason} highlight={i === 0} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Disclosure
        className="mt-5"
        summary="Things that could change this result"
        hint={`${profile.caveats.length} caveat${profile.caveats.length === 1 ? "" : "s"}, plus the framework disclaimer.`}
      >
        <ul className="space-y-1.5">
          {profile.caveats.map((c) => (
            <li key={c} className="flex gap-2 text-sm leading-relaxed text-haze-200">
              <span aria-hidden="true" className="text-warn-400">
                —
              </span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-xl border border-ink-700 bg-ink-900 p-3 text-xs leading-relaxed text-haze-300">
          {profile.disclaimer}
        </p>
      </Disclosure>
    </Section>
  );
}

/** The palette, plus the undertone signal audit. */
export function PaletteAndSignals({ profile }: { profile: ColorProfile }) {
  return (
    <Section>
      <SectionHeading
        eyebrow="Your palette"
        title="Colours that work on you"
        note="The reference the makeup generator and the garment checker both measure against."
      />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {profile.season.palette.map((p) => (
          <li key={p.hex}>
            <Swatch hex={p.hex} label={p.name} sublabel={p.role} size="md" />
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <h3 className="eyebrow text-alert-300">Harder to wear near the face</h3>
        <ul className="mt-3 grid grid-cols-3 gap-3">
          {profile.season.avoid.map((a) => (
            <li key={a.hex}>
              <Swatch hex={a.hex} label={a.name} size="sm" />
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 space-y-2">
        <Disclosure summary="How the undertone was decided" hint="The weighted vote behind warm, cool or neutral.">
          <p className="text-xs leading-relaxed text-haze-300">
            Warm and cool are voted on by several independent signals, weighted, then combined. Skin
            hue angle alone cannot separate them: on our reference set, warm and cool skins overlap by
            about one degree. Reporting a single confident answer from that would be misleading, so
            conflicting signals produce &ldquo;neutral&rdquo; instead of a guess.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-haze-300">{profile.undertone.reason}</p>
          <ul className="mt-3 space-y-2">
            {profile.undertone.signals.map((s) => (
              <li key={s.key} className="rounded-xl border border-ink-700 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-haze-100">{s.label}</span>
                  <span className="font-mono text-xs text-haze-300">
                    {s.value === null ? "n/a" : s.value.toFixed(2)} · vote{" "}
                    {s.vote > 0 ? "warm" : s.vote < 0 ? "cool" : "abstain"} · weight {s.weight}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-haze-300">{s.explanation}</p>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure summary="Why each axis landed where it did" hint="Depth, contrast and clarity, in order.">
          <ul className="space-y-1.5 text-xs leading-relaxed text-haze-300">
            <li>
              <span className="font-medium text-haze-200">Depth: </span>
              {profile.depth.reason}
            </li>
            <li>
              <span className="font-medium text-haze-200">Contrast: </span>
              {profile.contrast.reason}
            </li>
            <li>
              <span className="font-medium text-haze-200">Clarity: </span>
              {profile.clarity.reason}
            </li>
          </ul>
        </Disclosure>
      </div>
    </Section>
  );
}
