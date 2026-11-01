"""Browser test for the single -/+ pair. Run: EP133_URL=<url> uv run --with playwright python tests/params_test.py"""
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("EP133_URL") or sys.exit("Set EP133_URL")
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)

with sync_playwright() as p:
    kw = {}
    if os.environ.get("CHROMIUM"): kw["executable_path"] = os.environ["CHROMIUM"]
    b = p.chromium.launch(**kw)
    pg = b.new_context(viewport={"width": 1194, "height": 834}).new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(URL, wait_until="networkidle"); pg.evaluate("localStorage.clear()"); pg.reload(wait_until="networkidle")
    pg.click("#startBtn"); pg.wait_for_selector("#start.hide", state="attached", timeout=60000)
    t = lambda s: pg.inner_text(s).strip()
    check("starts on PATTERN 1", t("#pmPattern") == "PATTERN" and t("#pmVal") == "1")
    pg.click("#pmUp"); check("+ steps the pattern", t("#pmVal") == "2")
    pg.click("#pmDn"); pg.click("#pmDn"); check("- wraps the pattern to 99", t("#pmVal") == "99")
    pg.click("#pmTiming"); check("TIMING goes to BPM first", t("#pmTiming") == "BPM" and t("#pmVal") == "120")
    pg.click("#pmUp"); check("+ raises the tempo", t("#bpmVal") == "121" and t("#pmVal") == "121")
    pg.click("#pmTiming"); check("TIMING again goes to BARS", t("#pmTiming") == "BARS")
    pg.click("#pmTiming"); pg.click("#pmTiming"); check("then OCTAVE", t("#pmTiming") == "OCTAVE")
    pg.click("#pmDn"); check("- lowers the octave", t("#pmVal") == "-1")
    pg.click("#pmTiming"); check("TIMING wraps to BPM", t("#pmTiming") == "BPM")
    pg.click("#pmPattern"); check("PATTERN selects the pattern again", t("#pmVal") == "99" or t("#pmVal") == "1")
    pg.click("#pmSound")
    check("SOUND shows the pad's sound", t("#pmVal") != "")
    first = t("#pmVal"); pg.click("#pmUp")
    has_sounds = pg.evaluate("fetch('samples/catalogue.json').then((r) => r.ok).catch(() => false)")  # the factory catalogue is optional
    if has_sounds:
        check("+ moves to another sound", t("#pmVal") != first and t("#pmVal") != "--", t("#pmVal"))
        pg.click("#pmDn"); check("- moves back", t("#pmVal") == first, t("#pmVal"))
    else:
        check("with no sounds, + leaves the pad empty", t("#pmVal") == "--", t("#pmVal"))
    pg.click("#pmStep"); check("STEP starts at 1.1.1", t("#pmVal") == "1.1.1", t("#pmVal"))
    pg.click("#pmUp"); check("+ moves the step cursor", t("#pmVal") == "1.1.2", t("#pmVal"))
    pg.click("#pmDn"); pg.click("#pmDn"); check("- wraps to the last step", t("#pmVal") == "1.4.4", t("#pmVal"))
    pg.click("#bpmVal"); check("tapping the tempo selects BPM", t("#pmTiming") == "BPM")
    check("no page errors", not errs, str(errs))
    b.close()
sys.exit(1 if fails else 0)
