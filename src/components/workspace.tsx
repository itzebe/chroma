"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineResult } from "@/lib/pipeline";
import { Panel, SectionHeading, Badge, Callout } from "./ui";
import { MeasuredColours, SeasonProfile, PaletteAndSignals } from "./profile";
import { LookGallery } from "./looks";
import { GarmentChecker } from "./garment";
import { ShadeMatcher } from "./shades";

interface Health {
  apiConfigured: boolean;
}

export function Workspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preferRecorded, setPreferRecorded] = useState(true);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ apiConfigured: false }));
  }, []);

  // Revoke object URLs so a long session does not leak them.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      let res: Response;
      if (preferRecorded) {
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
      const data: PipelineResult = await res.json();
      setResult(data);
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setResult({
        ok: false,
        source: "live",
        code: "NetworkError",
        title: "Could not reach the analysis endpoint",
        message: "The request to the server failed.",
        guidance: "Check that the server is running, then try again.",
        retryable: true,
        unitsSpent: false,
      });
    } finally {
      setBusy(false);
    }
  }, [file, imageUrl, preferRecorded]);

  const liveImageUrl = !preferRecorded && imageUrl.trim() ? imageUrl.trim() : undefined;
  const canRunLive = Boolean(file || imageUrl.trim());

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">YouCam API</Badge>
          <Badge tone="neutral">skin-tone-analysis</Badge>
          <Badge tone="neutral">makeup-vto</Badge>
          {health ? (
            health.apiConfigured ? (
              <Badge tone="live">API key configured</Badge>
            ) : (
              <Badge tone="warn">no API key</Badge>
            )
          ) : null}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-haze-100 sm:text-4xl">
          Chroma
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-haze-200">
          A skin intelligence and virtual try-on workspace. The YouCam API measures the actual
          colours on your face; those measurements are turned into a seasonal colour profile, and
          from that profile the app <em>computes</em> makeup looks, judges whether a garment colour
          works on you, and ranks product shades. Change the photo and every number below changes
          with it.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          <SectionHeading
            eyebrow="Input"
            title="Choose a photo"
            note="One face, facing the camera, filling more than half the frame width, in even light. Photos that fail the API's angle checks are rejected before you are charged."
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPreferRecorded(true)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                preferRecorded
                  ? "border-signal-500/50 bg-signal-500/15 text-signal-300"
                  : "border-ink-700 bg-ink-850 text-haze-200"
              }`}
            >
              Recorded sample
            </button>
            <button
              onClick={() => setPreferRecorded(false)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                !preferRecorded
                  ? "border-signal-500/50 bg-signal-500/15 text-signal-300"
                  : "border-ink-700 bg-ink-850 text-haze-200"
              }`}
            >
              Live measurement
            </button>
          </div>

          {preferRecorded ? (
            <p className="mt-3 text-sm leading-relaxed text-haze-300">
              Replays a response captured from the live API. This is real API output, not a mock, but
              it is not a new measurement and is labelled as recorded everywhere it appears.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="photo" className="text-sm font-medium text-haze-100">
                  Upload a photo
                </label>
                <input
                  id="photo"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(f ? URL.createObjectURL(f) : null);
                  }}
                  className="mt-1 block w-full rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-sm text-haze-200 file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-haze-100"
                />
              </div>
              <div>
                <label htmlFor="url" className="text-sm font-medium text-haze-100">
                  or paste a public image URL
                </label>
                <input
                  id="url"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setFile(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  placeholder="https://example.com/selfie.jpg"
                  className="mt-1 block w-full rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-sm text-haze-200"
                />
              </div>
            </div>
          )}

          <button
            onClick={run}
            disabled={busy || (!preferRecorded && !canRunLive)}
            className="mt-4 w-full rounded-lg border border-signal-500/50 bg-signal-500/20 px-4 py-3 text-sm font-semibold text-signal-300 disabled:opacity-40 sm:w-auto"
          >
            {busy ? "Analysing…" : preferRecorded ? "Load the recorded analysis" : "Measure my skin colours"}
          </button>
        </Panel>

        <Panel className="p-5">
          <SectionHeading
            eyebrow="Why this needs the API"
            title="The test every feature had to pass"
            note="Would this work the same without YouCam? If yes, it does not belong here."
          />
          <ul className="space-y-3 text-sm leading-relaxed text-haze-200">
            <li>
              <span className="font-semibold text-haze-100">The colours are measured, not chosen.</span>{" "}
              Skin, lip, eye and brow hex values come from the API reading your photo. Nothing in this
              app asks you to self-report your undertone.
            </li>
            <li>
              <span className="font-semibold text-haze-100">The looks are computed.</span> The makeup
              engine accepts arbitrary hex colours, so every look is derived from your measured
              palette by explicit Lab transformations, each of which is printed on screen.
            </li>
            <li>
              <span className="font-semibold text-haze-100">The render is real.</span> The try-on
              endpoint composites those computed colours onto your actual photo.
            </li>
            <li>
              <span className="font-semibold text-haze-100">The shopping advice is grounded.</span>{" "}
              Garment verdicts and shade rankings are distances from your measured colours, not a
              static chart.
            </li>
          </ul>
        </Panel>
      </div>

      {previewUrl ? (
        <div className="mt-6">
          <Panel className="p-5">
            <SectionHeading eyebrow="Preview" title="The photo that will be measured" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Your uploaded photo, which will be sent to the YouCam API"
              className="max-h-80 rounded-lg border border-ink-700"
            />
          </Panel>
        </div>
      ) : null}

      <div ref={resultsRef} className="mt-8 space-y-6">
        {result && !result.ok ? (
          <Panel className="p-5">
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
          </Panel>
        ) : null}

        {result && result.ok ? (
          <>
            <Panel className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={result.source === "live" ? "live" : "recorded"}>
                  {result.source === "live" ? "measured live just now" : "recorded response"}
                </Badge>
                <span className="text-xs leading-relaxed text-haze-300">{result.provenance}</span>
              </div>
            </Panel>

            {result.warnings.length > 0 ? (
              <Panel className="p-5">
                <h3 className="text-sm font-semibold text-warn-300">
                  {result.warnings.length} thing{result.warnings.length === 1 ? "" : "s"} to know about
                  this result
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {result.warnings.map((w) => (
                    <li key={w} className="flex gap-2 text-sm leading-relaxed text-haze-200">
                      <span aria-hidden="true" className="text-warn-400">
                        —
                      </span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <MeasuredColours profile={result.profile} quality={result.quality} />
            <SeasonProfile profile={result.profile} />
            <PaletteAndSignals profile={result.profile} />
            <LookGallery
              looks={result.looks}
              profile={result.profile}
              imageUrl={liveImageUrl}
              measured={result.measured}
              quality={result.quality}
              source={result.source}
              sourceRef={result.sourceRef}
              apiConfigured={Boolean(health?.apiConfigured)}
            />
            <GarmentChecker profile={result.profile} />
            <ShadeMatcher profile={result.profile} />
          </>
        ) : null}

        {!result ? (
          <Panel className="p-6">
            <SectionHeading
              eyebrow="Get started"
              title="Load the recorded analysis to explore"
              note="Everything below the fold is generated from the measurement, so loading the sample is enough to see the whole product working."
            />
            <p className="text-sm leading-relaxed text-haze-300">
              With a YouCam API key and available units, switch to a live measurement and upload a
              photo. Without units, the recorded sample still drives every computation except the
              try-on render.
            </p>
          </Panel>
        ) : null}
      </div>

      <footer className="mt-10 border-t border-ink-800 pt-6">
        <p className="text-xs leading-relaxed text-haze-400">
          Built for the YouCam API Skin AI &amp; eCommerce VTO Hackathon. Seasonal colour analysis is
          a styling framework, not a scientific or medical assessment. No third-party brand names or
          trademarked shade names are used. Photos are sent to the YouCam API for measurement and are
          not stored by this app.
        </p>
      </footer>
    </div>
  );
}
