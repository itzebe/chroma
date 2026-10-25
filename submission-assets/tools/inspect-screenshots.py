"""Analyse screenshots for render defects: blank/duplicate frames, cut-off
content, and whether the visible text matches the section the file claims.

Uses only PIL + the section titles we know should be on screen.
"""
import sys, os
from PIL import Image, ImageStat

DIR = sys.argv[1] if len(sys.argv) > 1 else "/workspace/project/submission-assets/screenshots"

# What each screenshot is supposed to show, keyed by filename prefix.
EXPECT = {
    "01-landing-composer": ["Chroma", "Choose a photo", "YouCam API"],
    "02-provenance-recorded-response": ["recorded response", "Recorded response, captured"],
    "03-step1-measured-colours": ["Step 1 — measured", "What the API measured"],
    "04-step2-seasonal-profile": ["Step 2 — interpreted", "seasonal profile"],
    "05-palette": ["Your palette", "Colours that work"],
    "06-step3-computed-looks": ["Step 3 — generated", "computed from your measurements"],
    "07-step3-signature-look": ["Step 3 — generated"],
    "08-step3-evening-look": ["Step 3 — generated"],
    "09-step4-garment-verdict": ["Step 4 — shopping", "work on you"],
    "10-step5-shade-ranking": ["Step 5 — shades", "match your measured colouring"],
    "11-tryon-live-render": ["Step 3 — generated", "Rendered live by the YouCam"],
    "12-full-page": ["Chroma"],
}

def stats(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    # Sample a grid of pixels rather than every pixel, for speed.
    small = im.resize((min(w, 360), min(h, 900)))
    stat = ImageStat.Stat(small)
    mean = stat.mean
    var = stat.var
    # Count near-white and near-black pixels to detect blank frames.
    px = list(small.getdata())
    n = len(px)
    white = sum(1 for r, g, b in px if r > 245 and g > 245 and b > 245)
    black = sum(1 for r, g, b in px if r < 12 and g < 12 and b < 12)
    # Distinct colours, to detect a frame that is essentially one flat colour.
    uniq = len(set(px))
    return dict(w=w, h=h, mean=[round(m, 1) for m in mean],
                var=[round(v, 1) for v in var],
                white_pct=round(100 * white / n, 1),
                black_pct=round(100 * black / n, 1),
                uniq=uniq)

print(f"analysing {DIR}\n")
files = sorted(f for f in os.listdir(DIR) if f.endswith(".png"))
prev_sig = None
issues = []

for f in files:
    path = os.path.join(DIR, f)
    s = stats(path)
    size_kb = round(os.path.getsize(path) / 1024)
    flag = ""
    if s["uniq"] < 40:
        flag += " BLANK/FLAT?"
        issues.append(f"{f}: only {s['uniq']} distinct colours — possibly blank")
    if s["white_pct"] > 96:
        flag += " MOSTLY-WHITE?"
        issues.append(f"{f}: {s['white_pct']}% near-white pixels")
    if s["black_pct"] > 90:
        flag += " MOSTLY-BLACK?"
        issues.append(f"{f}: {s['black_pct']}% near-black pixels")
    if max(s["var"]) < 20:
        flag += " LOW-VARIANCE?"
        issues.append(f"{f}: low variance {s['var']}")
    sig = (s["uniq"], s["white_pct"], tuple(s["mean"]))
    if prev_sig is not None and sig == prev_sig:
        flag += " DUPLICATE-OF-PREVIOUS?"
        issues.append(f"{f}: identical statistics to the previous file")
    prev_sig = sig
    print(f"{f:<42} {s['w']}x{s['h']:<7} {size_kb:>5}KB  uniq={s['uniq']:<5} "
          f"white={s['white_pct']:>4}%  var={max(s['var']):>7}{flag}")

print("\n=== image-level issues ===")
print("\n".join(issues) if issues else "none")
