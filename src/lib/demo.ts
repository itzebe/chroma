/**
 * Recorded demo data.
 *
 * WHY THIS EXISTS
 * The app is built to call the YouCam API live. When the API key has no units
 * left (or the reviewer is offline), the app can still be explored end to end
 * using the responses below, which were captured from REAL live API calls and are
 * reproduced verbatim. Every consumer of this file must label the data as
 * RECORDED and must never present it as a live measurement.
 *
 * The UI enforces that with a visible badge and a banner, and `source` in the
 * pipeline result is `"recorded"` rather than `"live"`.
 *
 * Captured: 2026-10-24, against yce-api-01.makeupar.com, using
 * `POST /s2s/v2.0/task/skin-tone-analysis` with face_angle_strictness_level
 * "high". No field has been altered.
 */

export interface RecordedSample {
  id: string;
  /** Shown in the UI so the reviewer knows what was measured. */
  label: string;
  description: string;
  /** Public URL of the exact image that was measured. */
  imageUrl: string;
  capturedAt: string;
  endpoint: string;
  /** Verbatim API response body (`data` object). */
  response: {
    error: null;
    task_status: "success";
    results: {
      color: {
        skin_color: string;
        skin_color_name?: string;
        lip_color: string;
        eye_color: string;
        eye_color_name?: string;
        eyebrow_color: string;
        hair_color?: string;
        hair_color_name?: string;
      };
      face_quality: {
        has_face: boolean;
        area: string;
        frontal: string;
        lighting: string;
        faceangle: string;
      };
    };
  };
}

/**
 * One verbatim successful measurement.
 *
 * Note what is NOT here: `hair_color`. The API documents that field but did not
 * return it, which is why the classifier treats hair as optional and reports the
 * omission rather than inventing a value.
 */
export const RECORDED_SAMPLES: RecordedSample[] = [
  {
    id: "reference-face",
    label: "Reference portrait",
    description:
      "A front-facing portrait from the YouCam API documentation assets. Measured live, and the only one of six candidate images that passed the API's face-angle checks.",
    imageUrl:
      "https://bcw-media.s3.ap-northeast-1.amazonaws.com/img_Face_Ratio_sec_02_02_enu_21a3d8d423.jpg",
    capturedAt: "2026-10-24",
    endpoint: "POST /s2s/v2.0/task/skin-tone-analysis",
    response: {
      error: null,
      task_status: "success",
      results: {
        color: {
          eye_color: "#553829",
          eye_color_name: "Brown",
          lip_color: "#c98e93",
          eyebrow_color: "#3e3834",
          skin_color: "#ba8e6e",
        },
        face_quality: {
          has_face: true,
          area: "good",
          frontal: "good",
          lighting: "good",
          faceangle: "downward",
        },
      },
    },
  },
];

export const DEFAULT_RECORDED_SAMPLE_ID = "reference-face";

export function getRecordedSample(id?: string): RecordedSample {
  if (id) {
    const found = RECORDED_SAMPLES.find((s) => s.id === id);
    if (found) return found;
  }
  return RECORDED_SAMPLES[0];
}

/**
 * Engine failures observed live while probing candidate images. These are real
 * API error codes and messages, kept so the UI's error guidance can be exercised
 * without spending units.
 */
export const RECORDED_FAILURES = [
  {
    imageUrl:
      "https://plugins-media.makeupar.com/smb/blog/post/2022-08-19/2a1af800-7c69-44a5-a94c-70a4a9c4d2b0.jpg",
    error: "error_face_not_forward_facing",
    error_message: "The face in the input image is not facing forward.",
  },
  {
    imageUrl: "https://bcw-media.s3.ap-northeast-1.amazonaws.com/shade_finder_s4_poster_399f34c6ef.jpg",
    error: "error_face_angle_downward",
    error_message: null,
  },
  {
    imageUrl: "https://bcw-media.s3.ap-northeast-1.amazonaws.com/shade_finder_s5_poster_2_8a8f9307d2.png",
    error: "error_face_position_too_small",
    error_message: null,
  },
] as const;
