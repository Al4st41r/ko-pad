"""Phone layout checks at iPhone sizes (portrait and landscape).

Run:  EP133_URL=<address of the served web folder> uv run --with playwright python tests/phone_test.py
Set CHROMIUM to a headless_shell path if playwright's own browser is not installed.
"""
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("EP133_URL") or sys.exit("Set EP133_URL to the address of the served web folder")
fails = []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)

def box(page, sel):
    return page.eval_on_selector(sel, "e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }")

with sync_playwright() as p:
    kw = {}
    if os.environ.get("CHROMIUM"): kw["executable_path"] = os.environ["CHROMIUM"]
    b = p.chromium.launch(**kw)
    for label, (w, h) in {"portrait 393": (393, 852), "portrait 375": (375, 667), "landscape 852": (852, 393), "landscape 667": (667, 375)}.items():
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True)
        page = ctx.new_page(); page.goto(URL); page.wait_for_selector("#startBtn")
        page.evaluate("document.getElementById('start').classList.add('hide')")
        check(f"{label}: no page scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight"))
        pad = box(page, ".pad")
        check(f"{label}: pads at least 44px", pad["w"] >= 44 and pad["h"] >= 44, str(pad))
        pads, strip = box(page, "#pads"), box(page, "#modesMain")
        check(f"{label}: pads and controls do not overlap", pads["x"] + pads["w"] <= strip["x"] + 1 or pads["y"] + pads["h"] <= strip["y"] + 1, f"{pads} {strip}")
        tabs = box(page, "#tabs")
        check(f"{label}: tab bar visible and on screen", tabs["w"] > 0 and tabs["x"] + tabs["w"] <= w + 1 and tabs["y"] + tabs["h"] <= h + 1, str(tabs))
        check(f"{label}: every tab button at least 44px", page.evaluate("[...document.querySelectorAll('#tabs button')].every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })"))
        check(f"{label}: panel hidden on pads view", not page.is_visible("#tabBody"))
        page.click("#tabs [data-tab=MIX]")
        check(f"{label}: MIX shows the panel and hides the pads", page.is_visible("#tabBody") and not page.is_visible("#pads"))
        mix = page.evaluate("(() => { const c = document.querySelector('#tabBody'); return c.scrollWidth <= c.clientWidth + 1; })()")
        check(f"{label}: MIX does not scroll sideways", mix)
        page.click("#tabs [data-view=pads]")
        check(f"{label}: PADS returns to the pads", page.is_visible("#pads") and not page.is_visible("#tabBody"))
        page.click("#btnTools")
        check(f"{label}: TOOLS opens the sheet", page.is_visible("#btnCorrAll") and page.is_visible("#beatUp"))
        page.mouse.click(pad["x"] + 5, pad["y"] + 5)
        check(f"{label}: tapping outside closes the sheet", not page.is_visible("#btnCorrAll"))
        page.click("#btnMore")
        check(f"{label}: ... reveals METRO, TAP and SWING", page.is_visible("#btnMetro") and page.is_visible("#bpmTap") and page.is_visible("#swing"))
        ctx.close()
    ctx = b.new_context(viewport={"width": 1194, "height": 834}); page = ctx.new_page(); page.goto(URL); page.wait_for_selector("#startBtn")
    page.evaluate("document.getElementById('start').classList.add('hide')")
    check("iPad: tab panel and pads both visible", page.is_visible("#tabBody") and page.is_visible("#pads"))
    check("iPad: phone-only buttons hidden", not page.is_visible("#btnMore") and not page.is_visible("#btnTools"))
    b.close()
sys.exit(1 if fails else 0)
