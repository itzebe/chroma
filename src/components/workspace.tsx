"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineResult } from "@/lib/pipeline";
import { readApiResult, networkFailure } from "@/lib/api-response";
import { fileSizeError, MAX_UPLOAD_MB } from "@/lib/upload-limit";
import { DEFAULT_RECORDED_SAMPLE_ID } from "@/lib/demo";
import {
  Panel,
  SectionHeading,
  Badge,
  Callout,
  Disclosure,
  PrimaryButton,
  GhostButton,
  SegmentedChoice,
  Wordmark,
} from "./ui";
import { MeasuredColours, SeasonProfile, PaletteAndSignals } from "./profile";
import { LookGallery } from "./looks";
import { GarmentChecker } from "./garment";
import { ShadeMatcher } from "./shades";

interface Health {
  apiConfigured: boolean;
}

/** A four-segment colour wheel: the brand mark, drawn from the analysis palette. */
function ColourMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 10V0a10 10 0 0 1 10 10Z" fill="var(--color-blush-300)" />
      <path d="M10 10h10a10 10 0 0 1-10 10Z" fill="var(--color-blush-500)" />
      <path d="M10 10v10A10 10 0 0 1 0 10Z" fill="var(--color-gold-300)" />
      <path d="M10 10H0A10 10 0 0 1 10 0Z" fill="var(--color-signal-400)" />
      <circle cx="10" cy="10" r="3.1" fill="var(--color-ink-950)" />
    </svg>
  );
}

const MODES = [
  { value: "recorded" as const, label: "Recorded sample" },
  { value: "live" as const, label: "Live measurement" },
];

export function Workspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<"recorded" | "live">("live");
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((h: Health) => {
        if (cancelled) return;
        setHealth(h);
        // Lead with the photo upload, which is the product's main interaction.
        // Only fall back to the recorded sample when live analysis cannot run,
        // so the first thing offered is always something that works.
        if (!h.apiConfigured) setMode("recorded");
      })
      .catch(() => {
        if (cancelled) return;
        setHealth({ apiConfigured: false });
        setMode("recorded");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke object URLs so a long session does not leak them.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const chooseFile = useCallback(
    (f: File | null) => {
      const tooBig = f ? fileSizeError(f.size) : null;
      setFileError(tooBig);
      setFile(tooBig ? null : f);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return f && !tooBig ? URL.createObjectURL(f) : null;
      });
      if (f && !tooBig) setImageUrl("");
    },
    [],
  );

  const run = useCallback(
    async (override?: "recorded" | "live") => {
      const source = override ?? mode;
      // Re-check here as well as on selection, so a stale state cannot submit an
      // oversized file. The server guard is still the authority.
      if (source === "live" && file) {
        const tooBig = fileSizeError(file.size);
        if (tooBig) {
          setFileError(tooBig);
          return;
        }
      }
      setBusy(true);
      try {
        let res: Response;
        if (source === "recorded") {
          res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferRecorded: true }),
          });
        } else if (file) {
          const form = new FormData();
          form.append("file", file);
          res = await fetch("/api/analyze", { method: "POST", body: form });
        } else if (imageUrl.trim()) {
          res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: imageUrl.trim() }),
          });
        } else {
          res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferRecorded: true }),
          });
        }
        const data = await readApiResult<PipelineResult>(res);
        setResult(data);
        requestAnimationFrame(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } catch {
        setResult(networkFailure("analysis"));
      } finally {
        setBusy(false);
      }
    },
    [file, imageUrl, mode],
  );

  const canRunLive = Boolean(file || imageUrl.trim());
  const live = mode === "live";
  // Live analysis can only be offered once the server reports a usable key, so
  // the primary action is never a button that is guaranteed to fail.
  const liveAvailable = health === null || Boolean(health.apiConfigured);
  // Changes only when a new result arrives, which is what restarts the entrance
  // animation on the results block.
  const resultKey = result
    ? `${result.ok ? "ok" : "err"}-${result.source}-${result.ok ? result.measured.skin_color : result.code}`
    : "empty";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
      {/* ---------------------------------------------------------------- nav */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Wordmark />
        <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <a href="#composer" className="nav-link text-sm">
            Analyse
          </a>
          <a href="#how" className="nav-link text-sm">
            How it works
          </a>
          <a href="#privacy" className="nav-link text-sm">
            Privacy
          </a>
        </nav>
        <p aria-live="polite" className="flex items-center gap-2 text-xs text-haze-400">
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              health?.apiConfigured ? "bg-signal-400" : health ? "bg-warn-400" : "bg-ink-600"
            }`}
          />
          {health?.apiConfigured ? "YouCam connected" : health ? "YouCam key missing" : "Checking YouCam"}
        </p>
      </header>

      <div className="rule mt-4" />

      {/* -------------------------------------------------------------- hero */}
      <section className="mt-10 sm:mt-14">
        <p className="eyebrow text-blush-300">Skin intelligence &amp; virtual try-on</p>
        <h1 className="display mt-4 max-w-3xl text-[2.6rem] font-medium leading-[1.05] text-haze-100 sm:text-6xl lg:text-[4.25rem]">
          Your colours.
          <br />
          Your signature look.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-haze-200 sm:text-lg">
          One photo is measured by the YouCam API, and every colour, look and shade below is
          computed from your own face.
        </p>
      </section>

      {/* ---------------------------------------------------------- composer */}
      <section id="composer" className="mt-8 scroll-mt-6 sm:mt-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Panel className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="display text-xl font-medium text-haze-100">Start with a photo</h2>
              <SegmentedChoice
                label="Analysis source"
                value={mode}
                options={MODES}
                onChange={(m) => {
                  setMode(m);
                  setFileError(null);
                }}
              />
            </div>

            {live ? (
              <div className="mt-5 space-y-3">
                <input
                  id="photo"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                  className="peer sr-only"
                />
                <label
                  htmlFor="photo"
                  data-dragging={dragging ? "true" : "false"}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    chooseFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className="dropzone peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blush-300 flex min-h-40 cursor-pointer items-center justify-center rounded-2xl p-4 text-center"
                >
                  {previewUrl ? (
                    <span className="flex w-full items-center gap-4 text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="The photo you selected, which will be measured"
                        className="h-24 w-24 shrink-0 rounded-xl border border-ink-600 object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-haze-100">
                          {file?.name ?? "Selected photo"}
                        </span>
                        <span className="mt-0.5 block text-xs text-haze-400">
                          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ` : ""}
                          Tap to replace
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-2">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-600 bg-ink-900 text-haze-300">
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path
                            d="M10 4.5v11M4.5 10h11"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <span className="text-sm font-medium text-haze-100">
                        Drop a photo, or tap to choose one
                      </span>
                      <span className="text-xs text-haze-400">
                        Front-facing, one face, even light · JPEG or PNG up to {MAX_UPLOAD_MB} MB
                      </span>
                    </span>
                  )}
                </label>

                {fileError ? (
                  <Callout tone="warn" title="That image is too large">
                    {fileError}
                  </Callout>
                ) : null}

                <Disclosure
                  summary="Use an image link instead"
                  hint="Paste a public URL if the photo is already hosted somewhere."
                >
                  <label htmlFor="url" className="text-sm font-medium text-haze-100">
                    Public image URL
                  </label>
                  <input
                    id="url"
                    type="url"
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      setFile(null);
                      setFileError(null);
                      setPreviewUrl((current) => {
                        if (current) URL.revokeObjectURL(current);
                        return null;
                      });
                    }}
                    placeholder="https://example.com/selfie.jpg"
                    className="mt-2 block w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-haze-200 placeholder:text-haze-400"
                  />
                </Disclosure>
              </div>
            ) : (
              <div className="mt-5">
                <div className="flex items-start gap-4 rounded-2xl border border-ink-700 bg-ink-850 p-4">
                  <ColourMark className="mt-0.5 h-8 w-8 shrink-0" />
                  <p className="text-sm leading-relaxed text-haze-200">
                    Replays a response captured from the live API, so you can explore the whole
                    product without spending units.
                  </p>
                </div>
              </div>
            )}

            {/* Small, unobtrusive labels explaining recorded vs live. */}
            <p className="mt-3 flex items-center gap-2 text-xs text-haze-400">
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${live ? "bg-blush-400" : "bg-haze-400"}`}
              />
              {live
                ? "Live: measured now from your photo. One analysis costs 20 YouCam units."
                : "Recorded: real API output, replayed and labelled as recorded throughout."}
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <PrimaryButton
                onClick={() => void run()}
                disabled={busy || (live && (!canRunLive || !liveAvailable))}
                className="w-full sm:w-auto"
              >
                {busy ? "Analysing…" : live ? "Measure my skin colours" : "Load the recorded analysis"}
              </PrimaryButton>
              <a
                href="#how"
                className="inline-flex min-h-11 items-center justify-center text-sm text-haze-300 underline-offset-4 transition-colors hover:text-haze-100 hover:underline sm:justify-start"
              >
                See how it works
              </a>
            </div>

            {busy ? (
              <p role="status" className="mt-3 text-xs text-haze-400">
                {live
                  ? "Uploading and measuring. This can take up to a minute."
                  : "Loading the recorded analysis."}
              </p>
            ) : null}
          </Panel>

          {/* -------------------------------------------------------- how it works */}
          <Panel id="how" className="scroll-mt-6 p-5 sm:p-7">
            <SectionHeading
              eyebrow="How CHROMA works"
              title="Measured, then computed"
              note="Three steps, all downstream of one YouCam measurement."
            />
            <ol className="space-y-4">
              {[
                {
                  n: "01",
                  t: "Measure",
                  d: "The API reads the skin, lip, eye and brow colours off your photo.",
                },
                {
                  n: "02",
                  t: "Interpret",
                  d: "Those colours become a seasonal profile, scored on depth, contrast and warmth.",
                },
                {
                  n: "03",
                  t: "Create",
                  d: "Looks, garment verdicts and shade rankings are computed from your palette.",
                },
              ].map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="display w-8 shrink-0 text-sm text-blush-400">{s.n}</span>
                  <span>
                    <span className="block text-sm font-semibold text-haze-100">{s.t}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-haze-300">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-5 space-y-2">
              <Disclosure summary="Photo tips" hint="What makes a photo measurable.">
                <ul className="space-y-2 text-sm leading-relaxed text-haze-200">
                  <li>One face, facing the camera, filling more than half the frame width.</li>
                  <li>Even, diffuse light — no strong shadow across the face and no filter.</li>
                  <li>Hair away from the face so the skin and brow readings are clean.</li>
                  <li>
                    Photos that fail the API&rsquo;s angle checks are rejected before you are charged.
                  </li>
                </ul>
              </Disclosure>
              <Disclosure summary="Why the YouCam API is required" hint="The test every feature had to pass.">
                <p className="text-sm leading-relaxed text-haze-200">
                  The rule for this product: would it work the same without YouCam? If yes, it does
                  not belong here.
                </p>
                <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-haze-200">
                  <li>
                    <span className="font-semibold text-haze-100">The colours are measured, not chosen.</span>{" "}
                    Skin, lip, eye and brow values come from the API reading your photo. Nothing asks
                    you to self-report your undertone.
                  </li>
                  <li>
                    <span className="font-semibold text-haze-100">The looks are computed.</span> The
                    makeup engine accepts arbitrary colours, so every look is derived from your
                    measured palette by explicit Lab transformations.
                  </li>
                  <li>
                    <span className="font-semibold text-haze-100">The render is real.</span> The
                    try-on endpoint composites those computed colours onto your actual photo.
                  </li>
                  <li>
                    <span className="font-semibold text-haze-100">The shopping advice is grounded.</span>{" "}
                    Garment verdicts and shade rankings are perceptual distances from your measured
                    colours, not a static chart.
                  </li>
                </ul>
              </Disclosure>
            </div>
          </Panel>
        </div>
      </section>

      {/* --------------------------------------------------------- results */}
      {/* The `key` restarts the entrance animation when a new measurement
          replaces the previous one, so the transition reads as "new result"
          rather than the page quietly changing underneath the reader. */}
      <div ref={resultsRef} key={resultKey} className="results rise mt-8 scroll-mt-6 space-y-8 sm:space-y-10">
        {result && !result.ok ? (
          <div>
            <SectionHeading eyebrow="Result" title={result.title} />
            <div className="flex flex-wrap gap-2">
              <Badge tone={result.source === "recorded" ? "recorded" : "live"}>
                {result.source === "recorded" ? "recorded data" : "live request"}
              </Badge>
              <Badge tone="neutral">{result.code}</Badge>
              <Badge tone={result.unitsSpent ? "warn" : "good"}>
                {result.unitsSpent ? "units may have been charged" : "no units charged"}
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-haze-200">{result.message}</p>
            <div className="mt-3">
              <Callout tone="warn" title="What to do">
                {result.guidance}
              </Callout>
            </div>
          </div>
        ) : null}

        {result && result.ok ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={result.source === "live" ? "live" : "recorded"}>
                {result.source === "live" ? "measured live just now" : "recorded response"}
              </Badge>
              <span className="text-xs leading-relaxed text-haze-300">{result.provenance}</span>
            </div>

            {result.warnings.length > 0 ? (
              <Disclosure
                summary={`${result.warnings.length} thing${result.warnings.length === 1 ? "" : "s"} to know about this result`}
                hint="What the API did and did not return for this photo."
              >
                <ul className="space-y-2 text-sm leading-relaxed text-haze-200">
                  {result.warnings.map((w) => (
                    <li key={w} className="flex gap-2">
                      <span aria-hidden="true" className="text-warn-400">
                        —
                      </span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}

            <MeasuredColours profile={result.profile} quality={result.quality} />
            <SeasonProfile profile={result.profile} />
            <PaletteAndSignals profile={result.profile} />
            <LookGallery
              looks={result.looks}
              profile={result.profile}
              ticket={result.ticket ?? null}
              recordedSampleId={result.source === "recorded" ? DEFAULT_RECORDED_SAMPLE_ID : undefined}
              apiConfigured={Boolean(health?.apiConfigured)}
            />
            <GarmentChecker profile={result.profile} />
            <ShadeMatcher profile={result.profile} />
          </>
        ) : null}

        {!result ? (
          <div className="flex flex-col gap-4 border-t border-ink-800 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="eyebrow text-blush-300">Next</p>
              <h2 className="display mt-2 text-xl font-medium text-haze-100">
                Load the recorded analysis to explore
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-haze-300">
                Everything below the fold is generated from the measurement, so the sample is enough
                to see the whole product working.
              </p>
            </div>
            <GhostButton
              onClick={() => {
                setMode("recorded");
                void run("recorded");
              }}
              className="shrink-0"
            >
              Load the recorded analysis
            </GhostButton>
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- footer */}
      <footer className="mt-12 border-t border-ink-800 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Wordmark size="sm" />
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <a href="#how" className="nav-link text-xs">
              How it works
            </a>
            <a href="#privacy" className="nav-link text-xs">
              Privacy
            </a>
          </div>
        </div>

        <div id="privacy" className="mt-4 scroll-mt-6">
          <Disclosure summary="Privacy and photo handling" hint="What happens to the photo you upload.">
            <ul className="space-y-2 text-sm leading-relaxed text-haze-200">
              <li>
                Photos are sent to the YouCam API for measurement and are not stored by this app.
              </li>
              <li>
                Analysis and rendering are rate limited and capped by a daily unit ceiling, so the
                paid endpoints cannot be run away with.
              </li>
              <li>
                A render is bound to the measurement and photo it came from by a signed ticket, so a
                look can never be composited onto a different face.
              </li>
            </ul>
          </Disclosure>
        </div>

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-haze-400">
          Built for the YouCam API Skin AI &amp; eCommerce VTO Hackathon. Seasonal colour analysis is
          a styling framework, not a scientific or medical assessment. No third-party brand names or
          trademarked shade names are used.
        </p>
      </footer>
    </div>
  );
}
