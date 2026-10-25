# Judging notes

Answers to the questions the submission is most likely to raise, and the evidence
for each. The demo video is at [`video/chroma-demo.mp4`](video/chroma-demo.mp4)
(see [`video/README.md`](video/README.md) for its timings and provenance).

## "Is any of this faked?"

No. The measurement and the render are both real calls to the YouCam API, made by
the production deployment.

- The demo video is a single unedited run of <https://chroma-r8sd.vercel.app/>,
  with the browser URL bar in frame. The analysis at 0:32 and the render at 1:32
  are real requests; the recording contains no cut and no speed change.
- The app has no mock in the render path. When units run out, pressing render
  shows the API's actual `CreditInsufficiency` error, marked as retryable and as
  having charged no units.
- The **Recorded sample** button replays a real captured response, so the whole
  product can be exercised without spending units. It is labelled as recorded
  everywhere it appears, and that label is generated from the response's own
  provenance field rather than hard-coded prose. On a live call the same label
  reads "measured live just now".
- `screenshots/manifest.json` records the exact text visible in every screenshot,
  emitted at capture time. It is evidence, not a description written afterwards.

## "How much does a session cost?"

A skin tone analysis costs 20 units; each render costs 1 unit. Errors cost
nothing: the API documents that no units are consumed on a query or engine error,
and that matched what we measured. Everything downstream of the measurement is
local arithmetic, so the cost is per render, not per recommendation.

The demo video spends 21 units in total (one analysis, one render).

## "What would you do with more credits?"

Nothing structural. The live path is the same code with `preferRecorded: false`.
The render is already live, and it rebuilds the look from the measurement on
screen rather than from a fixture, so the composited photo always matches the
swatches above it.

## "Which YouCam API is used, and where?"

| Endpoint | Category | Where it is called |
| --- | --- | --- |
| `POST /s2s/v2.0/task/skin-tone-analysis` | Skin AI | `/api/analyze` — the root measurement |
| `POST /s2s/v2.0/task/makeup-vto` | Beauty / makeup VTO | `/api/render` — the virtual try-on |

Both share the upload and polling flow (`POST /s2s/v2.0/file`, then
`GET /s2s/v2.0/task/{id}`). See the repository README for the full sequence.

## "Is this a new project or an update?"

New. It was created during the Hackathon Submission Period (which opened
2026-09-29), has no prior history outside this repository, and was not derived
from an earlier codebase. The commit history is entirely within the submission
period.
