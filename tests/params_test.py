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
    check("starts on PATTERN 1", t("#pmSel") == "PATTERN" and t("#pmVal") == "1")
    pg.click("#pmUp"); check("+ steps the pattern", t("#pmVal") == "2")
    pg.click("#pmDn"); pg.click("#pmDn"); check("- wraps the pattern to 99", t("#pmVal") == "99")
    pg.click("#pmSel"); check("selector moves to BARS", t("#pmSel") == "BARS")
    pg.click("#pmSel"); check("then BPM", t("#pmSel") == "BPM" and t("#pmVal") == "120")
    pg.click("#pmUp"); check("+ raises the tempo", t("#bpmVal") == "121" and t("#pmVal") == "121")
    pg.click("#pmSel"); pg.click("#pmSel"); check("then OCTAVE", t("#pmSel") == "OCTAVE")
    pg.click("#pmDn"); check("- lowers the octave", t("#pmVal") == "-1")
    pg.click("#pmSel"); check("selector wraps to PATTERN", t("#pmSel") == "PATTERN")
    pg.click("#bpmVal"); check("tapping the tempo selects BPM", t("#pmSel") == "BPM")
    check("no page errors", not errs, str(errs))
    b.close()
sys.exit(1 if fails else 0)
