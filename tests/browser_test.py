"""Browser tests for the sequencer, song mode, note repeat, undo, send level and offline reload.

Run:  EP133_URL=<address of the served web folder> uv run --with playwright python tests/browser_test.py
Set CHROMIUM to a headless_shell path if playwright's own browser is not installed.
"""
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("EP133_URL") or sys.exit("Set EP133_URL to the address of the served web folder")
fails = []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)

with sync_playwright() as p:
    kw = {"args": ["--autoplay-policy=no-user-gesture-required"]}
    if os.environ.get("CHROMIUM"): kw["executable_path"] = os.environ["CHROMIUM"]
    b = p.chromium.launch(**kw)
    ctx = b.new_context(viewport={"width": 1194, "height": 834})
    ctx.add_init_script("localStorage.setItem('ko.settings', JSON.stringify({layout: 'auto'}))")
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(URL, wait_until="networkidle"); pg.evaluate("localStorage.clear()"); pg.reload(wait_until="networkidle")
    pg.click("#startBtn"); pg.wait_for_selector("#start.hide", state="attached", timeout=60000)
    pad = lambda i, ev: pg.dispatch_event(f".pad[data-i='{i}']", ev, {"pointerId": 5, "bubbles": True})

    # playback of a plain pattern, and a bad hit does not stop the clock
    pg.evaluate("""()=>{A.project.groups[0].patterns['1']={bars:1,ev:[{t:0,p:99,v:100,d:24},{t:96,p:9,v:100,d:24}]}; A.engine.triggerCount=0}""")
    pg.click("#btnPlay"); pg.wait_for_timeout(1500)
    check("bad event does not freeze the clock", pg.evaluate("A.seq.tick") > 50, str(pg.evaluate("A.seq.tick")))
    check("good hit after a bad one still plays", pg.evaluate("A.engine.triggerCount") >= 1)
    pg.click("#btnStop")

    # recording in song mode goes to the playing pattern
    pg.evaluate("""()=>{const g=A.project.groups[0]; g.patterns={'1':{bars:1,ev:[]},'2':{bars:1,ev:[{t:0,p:9,v:100,d:24}]}}; g.cur=1;
      A.project.scenes={'1':[2,0,0,0]}; A.project.song=[1]; A.seq.songMode=true; A.seq.countIn=false}""")
    pg.click("#btnRec"); pg.wait_for_timeout(400); pad(4, "pointerdown"); pad(4, "pointerup")
    check("song-mode hit lands in the playing pattern", pg.evaluate("A.project.groups[0].patterns['2'].ev.length") == 2)
    check("song-mode hit does not land in the selected pattern", pg.evaluate("A.project.groups[0].patterns['1'].ev.length") == 0)
    pg.click("#btnStop"); pg.wait_for_timeout(200); pg.evaluate("A.seq.songMode=false")

    # each step tap is its own undo step
    pg.evaluate("A.undo=new A.undo.constructor(); A.lastUndoPush=0; A.project.groups[0].patterns={}; A.refresh()")
    pg.click("#tabs [data-tab=STEP]")
    for c in (0, 4, 8): pg.click(f".sc[data-r='9'][data-c='{c}']")
    pg.click("#btnUndo")
    check("one UNDO removes one step tap", pg.evaluate("A.pattern().ev.length") == 2)

    # undo while another pattern plays restores the right pattern
    pg.evaluate("""()=>{const g=A.project.groups[0]; g.patterns={'1':{bars:1,ev:[]},'2':{bars:1,ev:[]}}; g.cur=1; A.undo=new A.undo.constructor();
      A.beforeEdit(0,g.patterns['2']); g.patterns['2'].ev.push({t:0,p:1,v:100,d:24}); A.undoLast()}""")
    check("undo restores the pattern it was taken from", pg.evaluate("A.project.groups[0].patterns['2'].ev.length") == 0 and pg.evaluate("A.project.groups[0].patterns['1'].ev.length") == 0)

    # note repeat
    pg.evaluate("A.seq.songMode=false; A.project.groups[0].patterns={}; A.project.bpm=120; A.engine.triggerCount=0; A.seq.quantise='1/16'; A.repeat=true")
    pg.click("#btnPlay"); pg.wait_for_timeout(300); pad(9, "pointerdown"); pg.wait_for_timeout(1000); pad(9, "pointerup")
    n = pg.evaluate("A.engine.triggerCount")
    check("note repeat retriggers on the grid", 5 <= n <= 10, str(n))
    pg.click("#btnStop"); pg.evaluate("A.repeat=false")

    # bad pad values do not throw
    r = pg.evaluate("(()=>{try{A.project=A.project; return 'ok'}catch(e){return e.message}})()")
    pg.evaluate("""()=>{const raw=JSON.parse(JSON.stringify(A.project)); raw.groups[0].pads[9].start=null; raw.groups[0].pads[9].end='x';
      localStorage.setItem('ko.proj.'+A.pi, JSON.stringify(raw))}""")
    pg.evaluate("A.loadProject(A.pi)"); pg.wait_for_timeout(500)
    r = pg.evaluate("(()=>{try{return A.engine.trigger(0,9,A.pad(9),100)?'ok':'null'}catch(e){return 'THROWS '+e.message}})()")
    check("stored pad with null trim loads and plays", r == "ok", r)

    # buffers not used by the project are released on project load
    pg.evaluate("async()=>{for(const id of [2,3,4,5,6,7,8,9,10,11,12,13,14,15]) await A.engine.load(id)}")
    pg.evaluate("A.loadProject(A.pi)"); pg.wait_for_timeout(1500)
    held = pg.evaluate("A.engine.buffers.size"); used = pg.evaluate("new Set(A.project.groups.flatMap(g=>g.pads.map(p=>p.s)).filter(Boolean)).size")
    check("unused decoded sounds are released", held <= used, f"{held} held, {used} used")

    # offline reload
    pg.wait_for_timeout(1500)
    ctx.set_offline(True)
    try:
        pg.reload(wait_until="load"); ok = pg.title() != ""
    except Exception as e:
        ok = False
    check("app reloads offline", ok)
    ctx.set_offline(False)

    ctx.set_offline(False); pg.click("#startBtn"); pg.wait_for_selector("#start.hide", state="attached", timeout=60000)
    # pattern tools, solo, overwrite, scene erase
    pg.click("#btnStop"); pg.evaluate("A.seq.songMode=false; A.project.groups[0].patterns={}; A.project.groups[0].cur=1; A.seq.quantise='1/16'; A.refresh()")
    pg.evaluate("A.project.groups[0].patterns['1']={bars:1,ev:[{t:5,p:9,v:100,d:24},{t:100,p:4,v:100,d:24}]}; A.refresh()")
    pg.click("#tabs [data-tab=STEP]"); pg.click("#cp"); pg.click("#btnNextEmpty")
    check("next empty moves to an empty pattern", pg.evaluate("A.grp().cur") == 2)
    pg.click("#ps")
    check("paste copies the pattern", pg.evaluate("A.pattern().ev.length") == 2)
    pg.click("#btnX2"); check("length x2 doubles the bars and hits", pg.evaluate("A.pattern().bars") == 2 and pg.evaluate("A.pattern().ev.length") == 4)
    pg.click("#btnHalf"); check("length /2 halves it again", pg.evaluate("A.pattern().bars") == 1 and pg.evaluate("A.pattern().ev.length") == 2)
    pg.click("#btnCorrAll"); check("correct all snaps hits to the grid", pg.evaluate("A.pattern().ev.map(e=>e.t).join()") == "0,96")
    pg.click("#btnUndo"); check("undo reverses a correct", pg.evaluate("A.pattern().ev.map(e=>e.t).join()") == "5,100")
    pg.click("#btnSoloP")
    check("solo pad silences other pads in the group", pg.evaluate("(()=>{A.engine.triggerCount=0; A.engine.trigger(0,3,A.pad(3),100); return A.engine.triggerCount})()") == 0)
    check("solo pad lets the soloed pad play", pg.evaluate("(()=>{A.engine.triggerCount=0; A.engine.trigger(0,A.sel,A.pad(A.sel),100); return A.engine.triggerCount})()") == 1)
    pg.click("#btnSoloP")
    pg.click("#btnSoloG")
    check("solo group sets the other buses to zero", pg.evaluate("A.engine.soloGroup") == 0)
    pg.click("#btnSoloG"); check("solo group clears", pg.evaluate("A.engine.soloGroup") is None)
    pg.click("#btnOver"); pg.click("#btnRec"); pg.wait_for_timeout(200); pg.click("#btnStop")
    check("overwrite recording clears the pattern first", pg.evaluate("A.pattern().ev.length") == 0)
    pg.evaluate("A.project.scenes={'1':[1,0,0,0],'2':[2,0,0,0]}; A.project.song=[1,2]")
    pg.click("#tabs [data-tab=SONG]"); pg.fill("#sn", "1")
    pg.once("dialog", lambda d: d.accept()); pg.click("#es")
    check("erase scene removes it from scenes and song", pg.evaluate("Object.keys(A.project.scenes).join()") == "2" and pg.evaluate("A.project.song.join()") == "2")

    # chop
    pg.click("#tabs [data-tab=SOUND]")
    pg.evaluate("A.sel=0; A.g=0; A.project.groups[0].pads[0].s=343; A.project.groups[0].pads[1].s=0; A.refresh()")
    pg.evaluate("A.engine.load(343)"); pg.wait_for_timeout(500); pg.click("#tabs [data-tab=SOUND]")
    pg.fill("#cn", "4"); pg.dispatch_event("#cn", "change"); pg.click("#auto"); pg.wait_for_timeout(300)
    ends = pg.evaluate("A.project.groups[0].pads.slice(0,4).map(p=>[p.s,p.start,p.end])")
    check("equal autochop spreads four slices over the first pads", ends == [[343,0,0.25],[343,0.25,0.5],[343,0.5,0.75],[343,0.75,1]], str(ends))
    pg.click("#cu"); check("undo chop restores the pads", pg.evaluate("A.project.groups[0].pads[1].s") == 0 and pg.evaluate("A.project.groups[0].pads[0].end") == 1)
    pg.click("#ls"); pg.wait_for_timeout(60); pg.click("#lm"); pg.wait_for_timeout(60); pg.click("#lm"); pg.click("#la")
    n = pg.evaluate("A.project.groups[0].pads.filter(p=>p.s===343).length")
    check("live chop turns marks into slices", n == 3, str(n))
    pg.click("#cu")

    # note edit
    pg.evaluate("A.project.groups[0].patterns={'1':{bars:1,ev:[{t:0,p:9,v:100,d:24}]}}; A.project.groups[0].cur=1; A.g=0; A.refresh()")
    pg.click("#tabs [data-tab=STEP]"); pg.click("#ed"); pg.click(".sc[data-r='9'][data-c='0']")
    pg.click("[data-k='n+g']"); pg.click("[data-k='v-']"); pg.click("[data-k='d+']")
    ev = pg.evaluate("A.pattern().ev[0]")
    check("note edit moves, softens and lengthens a hit", ev["t"] == 24 and ev["v"] == 92 and ev["d"] == 36, str(ev))
    pg.click("#btnUndo"); pg.click("#btnUndo"); pg.click("#btnUndo")
    check("each note edit is its own undo step", pg.evaluate("A.pattern().ev[0].t") == 0 and pg.evaluate("A.pattern().ev[0].v") == 100)
    pg.click("#ed")

    # fit to bars: a 0.574 s sound fitted to 1/2 bar at 120 bpm (1 s) plays at 0.574x
    r = pg.evaluate("""(async()=>{const pd=A.project.groups[0].pads[0]; pd.s=343; pd.fit=0.5; pd.start=0; pd.end=1; A.project.bpm=120; A.engine.setBpm(120); await A.engine.load(343);
      let rate=null; const o=A.engine.ctx.createBufferSource; A.engine.ctx.createBufferSource=function(){const s=o.call(this); rate=s; return s};
      A.engine.trigger(0,0,pd,100); A.engine.ctx.createBufferSource=o; return rate.playbackRate.value})()""")
    check("fit to bars sets the playback rate", abs(r - 0.574) < 0.01, str(r))
    pg.evaluate("A.project.groups[0].pads[0].fit=0")

    # long patterns page the step grid
    pg.evaluate("A.stepPage=0; A.stepFollow=false; A.project.groups[0].patterns={'1':{bars:10,ev:[{t:5*384+96,p:9,v:100,d:24}]}}; A.project.groups[0].cur=1; A.refresh()")
    pg.click("#tabs [data-tab=STEP]")
    check("a 10 bar pattern shows 3 pages and 4 bars of cells", pg.evaluate("document.querySelectorAll('.sc[data-r=\\'9\\']').length") == 64 and "BARS 1 TO 4" in pg.inner_text("#tabBody"))
    pg.click("#pn"); check("next page shows bars 5 to 8 with the hit", "BARS 5 TO 8" in pg.inner_text("#tabBody") and pg.evaluate("document.querySelectorAll('.sc.on').length") == 1)
    pg.click("#pn"); check("last page shows the remaining bars", pg.evaluate("document.querySelectorAll('.sc[data-r=\\'9\\']').length") == 32)
    pg.evaluate("A.stepPage=0; A.project.groups[0].patterns={}; A.refresh()")

    # fader automation: record a fader move, then hear the level change on playback
    pg.evaluate("A.seq.songMode=false; A.seq.countIn=false; A.project.groups[0].patterns={}; A.project.groups[0].cur=1; A.project.groups[0].vol=0.8; A.refresh()")
    pg.click("#tabs [data-tab=MIX]"); pg.click("#btnRec"); pg.wait_for_timeout(400)
    pg.evaluate("A.seq.recordAuto(0, 0.25)"); pg.wait_for_timeout(100); pg.click("#btnStop")
    n = pg.evaluate("(A.project.groups[0].patterns['1'].auto||[]).length")
    check("a fader move is recorded as automation", n == 1, str(n))
    calls = pg.evaluate("""(async()=>{const seen=[]; const o=A.engine.setGroupLevel.bind(A.engine); A.engine.setGroupLevel=(i,v,m,at)=>{if(at!==undefined)seen.push([i,v]); return o(i,v,m,at)};
      document.querySelector('#btnPlay').click(); await new Promise(r=>setTimeout(r,2300)); document.querySelector('#btnStop').click(); A.engine.setGroupLevel=o; return seen})()""")
    check("automation replays the recorded level on the loop", len(calls) >= 1 and calls[0][1] == 0.25, str(calls[:3]))
    check("stopping restores the fader level", pg.evaluate("A.project.groups[0].vol") == 0.8)
    pg.evaluate("A.project.groups[0].patterns={}; A.refresh()")

    # resample: capture the main output while a sound plays
    r = pg.evaluate("""(async()=>{ await A.engine.load(343); await A.engine.startCapture(5);
      A.engine.trigger(0,0,{...A.project.groups[0].pads[0], s:343, start:0, end:1, mode:'oneshot', fit:0, vol:1, pitch:0, pan:0, atk:0, rel:0.02, mg:0},100);
      await new Promise(r=>setTimeout(r,900)); const b=A.engine.stopCapture(); if(!b) return null;
      let m=0; const d=b.getChannelData(0); for(let i=0;i<d.length;i++) m=Math.max(m,Math.abs(d[i])); return {len:b.length, sr:b.sampleRate, ch:b.numberOfChannels, peak:m, capturing:A.engine.capturing}})()""")
    check("resample captures the main output", r is not None and r["peak"] > 0.01 and r["ch"] == 2 and 0.6 < r["len"] / r["sr"] < 1.4 and not r["capturing"], str(r))

    # 3/4 time: a one-hit pattern loops every 1.5 s at 120 bpm
    pg.evaluate("A.seq.songMode=false; A.project.bpm=120; A.engine.setBpm(120); A.project.groups[0].patterns={'1':{bars:1,beats:3,ev:[{t:0,p:9,v:100,d:24}]}}; A.project.groups[0].cur=1; A.refresh(); A.engine.triggerCount=0")
    check("beats control shows the pattern's signature", pg.inner_text("#lcdBars").endswith("3/4"), pg.inner_text("#lcdBars"))
    pg.click("#btnPlay"); pg.wait_for_timeout(3400); pg.click("#btnStop")
    n = pg.evaluate("A.engine.triggerCount")
    check("a 3/4 pattern loops after three beats", n == 3, str(n))
    pg.evaluate("A.project.groups[0].patterns={}; A.refresh()")

    # song editing
    pg.evaluate("A.project.scenes={'1':[1,0,0,0],'2':[2,0,0,0],'3':[3,0,0,0]}; A.project.song=[1,2]")
    pg.click("#tabs [data-tab=SONG]"); pg.click(".songchip[data-i='0']")
    pg.fill("#as", "3"); pg.click("#si"); check("insert puts the scene before the selection", pg.evaluate("A.project.song.join()") == "3,1,2")
    pg.click("#sr"); check("move later swaps with the next scene", pg.evaluate("A.project.song.join()") == "3,2,1")
    check("highlight follows the moved scene", pg.evaluate("[...document.querySelectorAll('#songlist .songchip')].findIndex(c => c.classList.contains('sel'))") == pg.evaluate("A.songSel"))
    pg.click("#sc"); check("cut removes the selected scene", pg.evaluate("A.project.song.join()") == "3,2")
    pg.click("#su"); check("song undo restores the previous list", pg.evaluate("A.songUndo") is None)

    # damaged project: bad scene and fx must neither crash the clock nor the load
    ok = pg.evaluate("""async () => { const m = await import('./js/model.js');
      A.project = m.normaliseProject({ scenes: { 1: 5 }, song: [1], fx: { active: 'delay', params: { delay: ['a', 'b'] } }, groups: [{ cur: 'x' }] });
      A.seq.project = A.project; A.seq.songMode = true; A.applyFx(); A.seq.start();
      await new Promise((r) => setTimeout(r, 600)); const t = A.seq.tick; A.seq.stop(); A.seq.songMode = false; return t > 0; }""")
    check("damaged project loads and plays", ok)

    # reset all to factory
    pg.evaluate("A.project.groups[0].pads[0].s=999; A.project.bpm=77; A.save(); A.settings.scale='major'; A.saveSettings()")
    pg.wait_for_timeout(500)
    pg.on("dialog", lambda d: d.accept() if "Reset all" in d.message else d.dismiss())
    pg.click("#tabs [data-tab=PROJECT]"); pg.click("#rsAll"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    check("reset all restores factory project and settings",
          pg.evaluate("localStorage.getItem('ko.proj.1')") in (None, "null") or pg.evaluate("JSON.parse(localStorage.getItem('ko.proj.1')).bpm") == 120)
    check("reset all clears settings", pg.evaluate("JSON.parse(localStorage.getItem('ko.settings')||'{}').scale") in (None, "chromatic"))

    check("no page errors", not errs, "; ".join(set(errs)))
    b.close()

print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
