"""The app with no sound files installed (the public repository case), and multi-file import.

Run:  uv run --with playwright python tests/nosounds_test.py
It serves a copy of web/ without web/samples contents, so it needs no server and no sample set.
Set CHROMIUM to a chromium or headless_shell path if playwright's own browser is not installed.
"""
import functools, http.server, math, os, shutil, struct, sys, tempfile, threading, wave
from pathlib import Path
from playwright.sync_api import sync_playwright

fails = []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)

def lum(rgb):
    r, g, b = [int(x) for x in rgb.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

tmp = Path(tempfile.mkdtemp())
site = tmp / "site"
shutil.copytree(Path(__file__).parent.parent / "web", site, ignore=shutil.ignore_patterns("*.flac", "catalogue.json"))
for i, f in enumerate((220, 330, 440)):
    with wave.open(str(tmp / f"t{i}.wav"), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * n / 44100))) for n in range(11025)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(site))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/"

with sync_playwright() as p:
    kw = {"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}
    b = p.chromium.launch(**kw)
    ctx = b.new_context(viewport={"width": 820, "height": 1180})
    ctx.add_init_script("localStorage.setItem('ko.settings', JSON.stringify({theme: 'light'}))")
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(url); page.wait_for_selector("#startBtn")
    start_h1 = page.evaluate("[getComputedStyle(document.querySelector('.start-card h1')).color, getComputedStyle(document.getElementById('start')).backgroundColor]")
    check("LIGHT: start screen text is lighter than its background", lum(start_h1[0]) > lum(start_h1[1]) + 100, str(start_h1))
    page.click("#startBtn"); page.wait_for_timeout(800)
    check("no sounds: every pad starts empty", page.evaluate("A.project.groups.every(g => g.pads.every(p => p.s === 0))"))
    check("no sounds: no 'not available' message", "not available" not in (page.text_content("#toast") or ""))
    page.evaluate("A.toast('Probe')")
    toast = page.evaluate("[getComputedStyle(document.getElementById('toast')).color, getComputedStyle(document.getElementById('toast')).backgroundColor]")
    check("LIGHT: toast text is lighter than its background", lum(toast[0]) > lum(toast[1]) + 100, str(toast))
    page.click("#tabs [data-tab=SOUND]")
    check("empty SOUND list explains how to add sounds", "IMPORT FILES" in page.text_content(".samplelist"))

    # Three files from pad index 9 (".", "0", "ENTER"), then three more from pad 10: only two pads are left.
    page.evaluate("A.sel = 9"); page.click("#tabs [data-tab=SOUND]")
    page.set_input_files("#file", [str(tmp / f"t{i}.wav") for i in range(3)]); page.wait_for_timeout(1500)
    check("import: three files fill pads 9 to 11 as 600, 601, 602", page.evaluate("A.project.groups[0].pads.slice(9).map(p => p.s)") == [600, 601, 602])
    page.evaluate("A.sel = 10"); page.click("#tabs [data-tab=SOUND]")
    page.set_input_files("#file", [str(tmp / f"t{i}.wav") for i in range(3)]); page.wait_for_timeout(1500)
    pads = page.evaluate("A.project.groups[0].pads.slice(9).map(p => p.s)")
    check("import: only the pads left are assigned", pads == [600, 603, 604], str(pads))
    check("import: the extra file is kept as a user sample", page.evaluate("A.sampleName(605)") != "EMPTY")
    check("import: toast says how many were left over", "1 more" in (page.text_content("#toast") or ""), page.text_content("#toast"))
    check("no script errors", not errs, str(errs))
    b.close()
srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
