"""make_catalogue.py must catalogue float WAV files and upper-case .WAV names. Needs ffmpeg. Run: python3 tests/catalogue_test.py"""
import json, subprocess, sys, tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as d:
    src = Path(d) / "001_Kick.WAV"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=0.5", "-c:a", "pcm_f32le", str(src)], check=True)
    out = Path(d) / "c.json"
    subprocess.run([sys.executable, "-I", str(Path(__file__).resolve().parent.parent / "tools" / "make_catalogue.py"), d, str(out)], check=True)
    rows = json.loads(out.read_text())
    assert len(rows) == 1 and rows[0]["id"] == 1 and abs(rows[0]["dur"] - 0.5) < 0.01, rows
print("PASS float WAV catalogued")
