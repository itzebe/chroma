/**
 * Runtime request schemas.
 *
 * TypeScript types vanish at runtime, so every field a client can send is
 * validated here before it is used. Values are length-bounded, hex colours are
 * checked against the accepted forms, and unknown keys are stripped so nothing
 * unexpected reaches the pipeline or the upstream API.
 */

import { z } from "zod";
import { DEFAULT_RECORDED_SAMPLE_ID } from "../demo.ts";

const HEX_COLOR = /^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/;

const hexColor = z.string().trim().max(7).regex(HEX_COLOR, "Must be a 3- or 6-digit hex colour.");
const sampleId = z.string().trim().min(1).max(64);
const qualityValue = z.string().trim().max(32).nullable().optional();

/** Measurement as returned by the analyse route and echoed back by the client. */
export const measuredSchema = z
  .object({
    skin_color: hexColor.optional(),
    lip_color: hexColor.optional(),
    eye_color: hexColor.optional(),
    eyebrow_color: hexColor.optional(),
    hair_color: hexColor.optional(),
    eye_color_name: z.string().trim().max(64).optional(),
    hair_color_name: z.string().trim().max(64).optional(),
  })
  .strict();

export const qualitySchema = z
  .object({
    has_face: z.boolean().optional(),
    area: qualityValue,
    frontal: qualityValue,
    lighting: qualityValue,
    faceangle: qualityValue,
  })
  .strict();

/**
 * Analyse request body.
 *
 * `source` is deliberately absent: provenance is derived server-side from what
 * actually happened, never from a client-supplied label.
 */
export const analyzeBodySchema = z
  .object({
    imageUrl: z.string().trim().max(2048).optional(),
    recordedSampleId: sampleId.optional(),
    preferRecorded: z.boolean().optional(),
  })
  .strict();

/** Render request body. The photo and measurement come from a signed ticket. */
export const renderBodySchema = z
  .object({
    lookId: z.enum(["everyday", "signature", "evening"]).optional(),
    ticket: z.string().trim().min(1).max(8192).optional(),
    recordedSampleId: sampleId.optional(),
  })
  .strict();

export type AnalyzeBody = z.infer<typeof analyzeBodySchema>;
export type RenderBody = z.infer<typeof renderBodySchema>;
export type MeasuredInput = z.infer<typeof measuredSchema>;
export type QualityInput = z.infer<typeof qualitySchema>;

export { DEFAULT_RECORDED_SAMPLE_ID };
