"""Theme and HARDWARE layout checks.

Run:  EP133_URL=<address of the served web folder> uv run --with playwright python tests/look_test.py
Set CHROMIUM to a chromium or headless_shell path if playwright's own browser is not installed.
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
    kw = {"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}
    b = p.chromium.launch(**kw)
    for label, (w, h) in {"ipad portrait": (820, 1180), "phone portrait": (393, 852), "desktop": (1280, 800)}.items():
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=True)
        ctx.add_init_script("localStorage.setItem('ko.settings', JSON.stringify({theme: 'light', layout: 'hardware'}))")
        page = ctx.new_page(); errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(URL); page.wait_for_selector("#startBtn"); page.click("#startBtn"); page.wait_for_timeout(800)
        check(f"{label}: light theme applied", page.evaluate("document.documentElement.dataset.theme") == "light")
        check(f"{label}: hardware layout applied", page.evaluate("document.getElementById('app').classList.contains('lay-hw')"))
        check(f"{label}: no page scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight"))
        tabs, top, pads, dials, side = (box(page, s) for s in ("#tabs", "#top", "#pads", "#dials", "#side"))
        check(f"{label}: tabs above pads, transport below", tabs["y"] < dials["y"] < pads["y"] < top["y"], f"{tabs} {pads} {top}")
        check(f"{label}: dials above the pads", dials["y"] + dials["h"] <= pads["y"] + 1, f"{dials} {pads}")
        check(f"{label}: side strip beside the pads", side["x"] >= pads["x"] + pads["w"] - 1 and abs(side["y"] - pads["y"]) < 4, f"{side} {pads}")
        check(f"{label}: transport on screen", top["y"] + top["h"] <= h + 1 and page.is_visible("#btnPlay"))
        pad = box(page, ".pad")
        check(f"{label}: pads at least 44px", pad["w"] >= 44 and pad["h"] >= 44, str(pad))
        check(f"{label}: 1px black outline on buttons in LIGHT", page.evaluate("(() => { const s = getComputedStyle(document.getElementById('btnPlay')); return s.borderTopWidth === '1px' && s.borderTopColor === 'rgb(0, 0, 0)'; })()"))
        check(f"{label}: tight radius in LIGHT", page.evaluate("parseFloat(getComputedStyle(document.querySelector('.pad')).borderTopLeftRadius) <= 4"))
        page.click("#sideKeys")
        check(f"{label}: side KEYS toggles keys mode", page.evaluate("A.keys") is True and page.get_attribute("#btnKeys", "aria-pressed") == "true")
        page.click("#fxCycle")
        check(f"{label}: FX button picks an effect", page.evaluate("A.project.fx.active") != "none")
        page.click("#sideFader")
        check(f"{label}: FADER opens the mixer and hides the pads", page.is_visible("#tabBody") and not page.is_visible("#pads"))
        page.click("#tabs [data-view=pads]")
        check(f"{label}: PADS returns to the pads", page.is_visible("#pads") and not page.is_visible("#tabBody"))
        check(f"{label}: no script errors", not errs, str(errs))
        ctx.close()
    # Switching look from the PROJECT tab, and back to AUTO on a landscape iPad.
    ctx = b.new_context(viewport={"width": 1180, "height": 820}, has_touch=True)
    page = ctx.new_page(); page.goto(URL); page.wait_for_selector("#startBtn"); page.click("#startBtn"); page.wait_for_timeout(500)
    page.click("#tabs [data-tab=PROJECT]")
    page.click(".seg button:text-is('BLACK')")
    check("PROJECT tab sets the BLACK theme", page.evaluate("document.documentElement.dataset.theme") == "black")
    check("AUTO layout has no hardware classes", not page.evaluate("document.getElementById('app').classList.contains('lay-hw')") and not page.is_visible("#dials"))
    page.click(".seg button:text-is('HARDWARE')")
    check("PROJECT tab switches to HARDWARE", page.evaluate("document.getElementById('app').classList.contains('lay-hw')"))
    b.close()

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
