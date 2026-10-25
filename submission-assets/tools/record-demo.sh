#!/usr/bin/env bash
# Record a genuine end-to-end run of the DEPLOYED Chroma app on a virtual
# display, with the real browser window (URL bar included) in frame, paced to
# the narration.
#
# Usage:
#   DEMO_MODE=recorded ./record-demo.sh          # dry run, 0 API units
#   DEMO_MODE=live     ./record-demo.sh          # real run, 21 API units
#
# Env: URL, PHOTO, OUT, SCREEN_SIZE (default 1600x900), DISPLAY_NUM (default 99)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${URL:-https://chroma-r8sd.vercel.app/}"
PHOTO="${PHOTO:-/tmp/chroma-face.jpg}"
OUT="${OUT:-/tmp/chroma-demo}"
SCREEN_SIZE="${SCREEN_SIZE:-1600x900}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
export DEMO_MODE="${DEMO_MODE:-recorded}"

FFMPEG_BIN="${FFMPEG_BIN:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}"
export FFMPEG_BIN

# Narration timings drive the scene pacing.
python3 "${HERE}/build-narration.py" "${OUT}/narration" >/dev/null
export TIMINGS="${OUT}/narration/timings.json"

pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null
sleep 1
Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN_SIZE}x24" -nolisten tcp >/tmp/xvfb-demo.log 2>&1 &
XVFB_PID=$!
sleep 3
export DISPLAY=":${DISPLAY_NUM}"
if ! xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
  echo "Xvfb failed to start on ${DISPLAY}" >&2
  exit 1
fi

echo "mode=${DEMO_MODE}  url=${URL}  size=${SCREEN_SIZE}  display=${DISPLAY}  out=${OUT}"
node "${HERE}/record-demo.mjs" "${URL}" "${PHOTO}" "${OUT}"
STATUS=$?

kill "${XVFB_PID}" 2>/dev/null
exit "${STATUS}"
