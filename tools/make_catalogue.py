"""Build catalogue.json (id, name, category, duration, channels) from a folder of WAVs named NNN_name.wav."""
import json, sys, wave
from pathlib import Path

CATS = [(1, 99, "KICK"), (100, 199, "SNARE"), (200, 299, "CYMB"),
        (300, 399, "PERC"), (400, 499, "BASS"), (500, 599, "MELOD")]

def cat(n):
    return next(c for lo, hi, c in CATS if lo <= n <= hi)

rows = []
for f in Path(sys.argv[1]).rglob("*.wav"):
    if not f.stem.partition("_")[0].isdigit() or not 1 <= int(f.stem.partition("_")[0]) <= 599:
        continue
    num, _, name = f.stem.partition("_")
    with wave.open(str(f)) as w:
        dur, ch = w.getnframes() / w.getframerate(), w.getnchannels()
    n = int(num)
    rows.append({"id": n, "name": name.strip() or f"sample {n}", "cat": cat(n), "dur": round(dur, 3), "ch": ch})
rows.sort(key=lambda r: r["id"])
Path(sys.argv[2]).write_text(json.dumps(rows, separators=(",", ":")))
print(len(rows), "samples")
