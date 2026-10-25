import { NextResponse } from "next/server";
import { analyze } from "@/lib/pipeline";
import { isConfigured } from "@/lib/youcam";

export const maxDuration = 120;

/**
 * Analyse a selfie.
 *
 * Accepts either multipart form data with a `file` field, or JSON with
 * `{ imageUrl }` or `{ recordedSampleId }`. The response always states whether
 * the numbers are live or recorded, so the client cannot accidentally present a
 * replayed fixture as a fresh measurement.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const recorded = form.get("recordedSampleId");

      if (recorded && typeof recorded === "string" && file === null) {
        return NextResponse.json(await analyze({ recordedSampleId: recorded, preferRecorded: true }));
      }
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, code: "NoImage", title: "No image supplied", message: "Attach an image file.", guidance: "Choose a JPEG or PNG photo of one face.", retryable: false, unitsSpent: false, source: "live" },
          { status: 400 },
        );
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, code: "FileTooLarge", title: "That image is too large", message: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`, guidance: "Use an image under 10 MB.", retryable: false, unitsSpent: false, source: "live" },
          { status: 413 },
        );
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      return NextResponse.json(
        await analyze({ bytes, contentType: file.type || "image/jpeg", fileName: file.name || "selfie.jpg" }),
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      imageUrl?: string;
      recordedSampleId?: string;
      preferRecorded?: boolean;
    };

    if (body.preferRecorded || (!body.imageUrl && body.recordedSampleId)) {
      return NextResponse.json(await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true }));
    }

    if (body.imageUrl) {
      try {
        const parsed = new URL(body.imageUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("bad protocol");
        }
      } catch {
        return NextResponse.json(
          { ok: false, code: "BadUrl", title: "That image URL is not valid", message: "Only http and https URLs are accepted.", guidance: "Paste a direct link to a JPEG or PNG image.", retryable: false, unitsSpent: false, source: "live" },
          { status: 400 },
        );
      }
      return NextResponse.json(await analyze({ imageUrl: body.imageUrl }));
    }

    // No image at all: replay the recorded sample rather than erroring, so the
    // app is explorable out of the box.
    return NextResponse.json(await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true }));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "ServerError",
        title: "The analysis could not be started",
        message: err instanceof Error ? err.message : "Unknown server error.",
        guidance: "Try again.",
        retryable: true,
        unitsSpent: false,
        source: "live",
      },
      { status: 500 },
    );
  }
}

/** Health and configuration probe. Never reveals the key itself. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    apiConfigured: isConfigured(),
    endpoint: "/s2s/v2.0/task/skin-tone-analysis",
  });
}
