"""Temporary end-to-end smoke test: drives headless Chrome over the DevTools
Protocol against http://127.0.0.1:8123 and checks the game rules end to end."""
import json, os, sys, time
from _cdp_lib import launch, WS

URL = "http://127.0.0.1:8123/index.html"
REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_e2e_report.txt")


class Tee:
    def __init__(self, path):
        self.f = open(path, "w", encoding="utf-8")

    def write(self, s):
        self.f.write(s)
        self.f.flush()
        try:
            sys.__stdout__.write(s)
        except Exception:
            pass

    def flush(self):
        self.f.flush()


sys.stdout = Tee(REPORT)

failures = []


def check(label, cond, extra=""):
    print(("  OK   " if cond else "  FAIL ") + label + (f"   [{extra}]" if extra else ""), flush=True)
    if not cond:
        failures.append(label)


proc, target = launch(URL, port=9335, profile_name="sag-e2e")
ws = None
try:
    ws = WS(target["webSocketDebuggerUrl"])
    ws.call("Runtime.enable", timeout=30)
    ws.call("Log.enable", timeout=30)

    ev = ws.evaluate  # shorthand

    print("\n== 1. boot ==", flush=True)
    booted = False
    for _ in range(60):
        try:
            booted = ev("!!(window.SAG && document.getElementById('boot').classList.contains('hidden'))", timeout=30)
        except Exception as e:
            booted = False
        if booted:
            break
        time.sleep(0.5)
    if not booted:
        try:
            print("    boot panel says:", ev("document.getElementById('boot').innerText", timeout=20))
        except Exception:
            pass
    check("app boots (loader hidden)", booted)
    if not booted:
        raise SystemExit

    info = ev("""(() => ({
      species: SAG.DB.species.length,
      spawnable: SAG.DB.spawnable.length,
      families: SAG.DB.familyMembers.size,
      rarityPools: Object.fromEntries(Object.entries(SAG.DB.byRarity).map(([k,v])=>[k,v.length])),
      mapReady: !!SAG.GameMap.map, leaflet: typeof L !== 'undefined'
    }))()""")
    print("   ", json.dumps(info), flush=True)
    check("79 creatures parsed from the CSV", info["species"] == 79, str(info["species"]))
    check("42 catchable Stage 1 creatures", info["spawnable"] == 42, str(info["spawnable"]))
    check("42 evolution families", info["families"] == 42, str(info["families"]))
    check("every rarity tier has a pool", all(v > 0 for v in info["rarityPools"].values()), json.dumps(info["rarityPools"]))
    check("Leaflet map created", info["mapReady"] and info["leaflet"])

    print("\n== 2. collection ==", flush=True)
    coll = ev("""(() => {
      document.querySelector('.nav-btn[data-view="collection"]').click();
      return {
        cells: document.querySelectorAll('#collection-grid .cell').length,
        locked: document.querySelectorAll('#collection-grid .cell.locked').length,
        firstId: document.querySelectorAll('#collection-grid .cell .nm')[0].textContent,
        lastId: [...document.querySelectorAll('#collection-grid .cell .nm')].pop().textContent,
        title: document.getElementById('set-title').textContent,
        prevDisabled: document.getElementById('set-prev').disabled,
        typeOptions: document.getElementById('filter-type').options.length
      };
    })()""")
    print("   ", json.dumps(coll), flush=True)
    check("all 79 creatures listed", coll["cells"] == 79, str(coll["cells"]))
    check("unregistered creatures greyed out", coll["locked"] == 79, str(coll["locked"]))
    check("sorted by id (Meditot first, Poltergnet last)",
          coll["firstId"] == "Meditot" and coll["lastId"] == "Poltergnet",
          f'{coll["firstId"]}..{coll["lastId"]}')
    check("set title is Elemental Awakening", coll["title"] == "Elemental Awakening")
    check("left arrow disabled on first set", coll["prevDisabled"] is True)
    check("type filter populated with 5 types", coll["typeOptions"] == 6, str(coll["typeOptions"]))

    nxt = ev("""(() => {
      document.getElementById('set-next').click();
      return { soonVisible: !document.getElementById('collection-soon').classList.contains('hidden'),
               soonText: document.querySelector('#collection-soon p').textContent,
               nextDisabled: document.getElementById('set-next').disabled,
               prevDisabled: document.getElementById('set-prev').disabled };
    })()""")
    print("   ", json.dumps(nxt), flush=True)
    check("right arrow shows the coming-soon page",
          nxt["soonVisible"] and "coming soon" in nxt["soonText"].lower(), nxt["soonText"])
    check("left arrow available to go back", not nxt["prevDisabled"] and nxt["nextDisabled"])
    ev("document.getElementById('set-prev').click(); true")

    print("\n== 3. collection filters ==", flush=True)
    filt = ev("""(() => {
      const set = (id,v) => { const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('change')); };
      const n = () => document.querySelectorAll('#collection-grid .cell').length;
      set('filter-type','Wind');   const wind = n();
      set('filter-stage','1');     const wind1 = n();
      set('filter-rarity','5');    const wind1r5 = n();
      const name = document.querySelector('#collection-grid .cell .nm')?.textContent;
      document.getElementById('filter-reset').click();
      return { wind, wind1, wind1r5, name, all: n() };
    })()""")
    print("   ", json.dumps(filt), flush=True)
    check("filter by type works", filt["wind"] == 15, str(filt["wind"]))
    check("filter by stage works (8 Wind Stage 1)", filt["wind1"] == 8, str(filt["wind1"]))
    check("filter by rarity works (Wind legendary = Pyrosora)",
          filt["wind1r5"] == 1 and filt["name"] == "Pyrosora", f'{filt["wind1r5"]} {filt["name"]}')
    check("reset restores the full list", filt["all"] == 79, str(filt["all"]))

    print("\n== 4. debug location + live Overpass scan ==", flush=True)
    ev("""(() => {
      document.querySelector('.nav-btn[data-view="map"]').click();
      document.getElementById('btn-debug').click();
      document.getElementById('dbg-lat').value = '51.5152';
      document.getElementById('dbg-lng').value = '-0.1419';
      document.getElementById('dbg-enable').checked = true;
      return true;
    })()""")
    scan = ev("""(async () => {
      const sp = await import('./js/spawns.js');
      SAG.store.clearSpawns();
      SAG.store.s.lastScanAt = 0;
      document.getElementById('dbg-apply').click();
      // wait for the scan kicked off by applying the debug location
      for (let i=0;i<240;i++) {
        if (SAG.store.s.lastScanAt && !sp.isScanning()) break;
        await new Promise(r=>setTimeout(r,250));
      }
      await new Promise(r=>setTimeout(r,300));
      return {
        fake: SAG.Geo.usingFake,
        badge: document.getElementById('geo-status').textContent,
        lastScanAt: SAG.store.s.lastScanAt,
        stillScanning: sp.isScanning(),
        spawns: SAG.store.activeSpawns().length,
        markers: SAG.GameMap.markers.size,
        log: document.getElementById('dbg-log').textContent.split('\\n').slice(-4)
      };
    })()""", timeout=300)
    print("   ", json.dumps(scan), flush=True)
    check("debug location applied", scan["fake"] is True and "Fake location" in scan["badge"], scan["badge"])
    check("scan completed against the live Overpass API",
          scan["lastScanAt"] > 0 and not scan["stillScanning"], json.dumps(scan["log"]))

    # Force a 100% scan so we always have material to test capture with.
    forced = ev("""(async () => {
      await SAG.doScan({ chance: 1, force: true, reason: 'e2e' });
      const s = SAG.store.activeSpawns();
      return {
        count: s.length,
        markers: SAG.GameMap.markers.size,
        countText: document.getElementById('spawn-count').textContent,
        allStage1: s.every(x => SAG.DB.byId.get(x.speciesId).stage === 1),
        allHaveRarity: s.every(x => !!SAG.DB.byId.get(x.speciesId).rarity),
        lifetimesOk: s.every(x => { const m=(x.expiresAt-x.createdAt)/60000; return m>=10 && m<=20; }),
        onePerPoi: new Set(s.map(x=>x.poiId)).size === s.length,
        onPoiCoords: s.every(x => isFinite(x.lat) && isFinite(x.lng)),
        sample: s.slice(0,4).map(x => ({ poi: x.poiName, kind: x.poiKind+'='+x.poiKindValue,
                 creature: SAG.DB.byId.get(x.speciesId).name,
                 mins: +(((x.expiresAt-x.createdAt)/60000).toFixed(1)) })),
        timerText: document.querySelector('.spawn-marker .spawn-timer')?.textContent || null
      };
    })()""", timeout=240)
    print("   ", json.dumps(forced), flush=True)
    check("spawns created at real shop/amenity POIs", forced["count"] > 0, str(forced["count"]))
    check("only Stage 1 creatures spawn", forced["allStage1"])
    check("spawned creatures always have a rarity", forced["allHaveRarity"])
    check("spawn lifetime is 10-20 minutes", forced["lifetimesOk"])
    check("one spawn per POI", forced["onePerPoi"])
    check("spawn sits on the POI coordinate", forced["onPoiCoords"])
    check("map markers match the spawn list", forced["markers"] == forced["count"],
          f'{forced["markers"]}/{forced["count"]}')
    check("spawn counter updated", "spawn" in forced["countText"], forced["countText"])
    check("countdown timer rendered above the spawn",
          bool(forced["timerText"]) and ":" in forced["timerText"], str(forced["timerText"]))

    sep = ev("""(() => {
      const s = SAG.store.activeSpawns();
      const d=(a,b)=>{const R=6371008.8,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=p2-p1,
        dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
        return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));};
      let min=Infinity;
      for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++)min=Math.min(min,d(s[i],s[j]));
      const me={lat:51.5152,lng:-0.1419};
      const maxFromMe = Math.max(...s.map(x=>d(me,x)));
      return { n:s.length, minSep: isFinite(min)? +min.toFixed(2): null, maxFromMe: +maxFromMe.toFixed(1) };
    })()""")
    print("   ", json.dumps(sep), flush=True)
    check("no two spawns within 5 m", sep["minSep"] is None or sep["minSep"] >= 5, str(sep["minSep"]))
    check("all spawns within the 100 m scan radius",
          sep["maxFromMe"] is not None and sep["maxFromMe"] <= 100, str(sep["maxFromMe"]))

    print("\n== 5. capture requires being within 5 m ==", flush=True)
    far = ev("""(async () => {
      const d=(a,b)=>{const R=6371008.8,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=p2-p1,
        dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
        return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));};
      const me = SAG.Geo.current;
      const s = SAG.store.activeSpawns().find(x => d(me,x) > 20);
      if (!s) return { skipped:true };
      const n = SAG.store.activeSpawns().length;
      const stored = SAG.store.s.storage.length;
      await SAG.tryCapture(s);
      await new Promise(r=>setTimeout(r,150));
      return { skipped:false, distance: Math.round(d(me,s)),
               spawnKept: SAG.store.activeSpawns().length === n,
               nothingStored: SAG.store.s.storage.length === stored,
               toast: [...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | '),
               stageHidden: document.getElementById('stage').classList.contains('hidden') };
    })()""", timeout=60)
    print("   ", json.dumps(far), flush=True)
    if far.get("skipped"):
        print("  ..   skipped (no spawn further than 20 m)", flush=True)
    else:
        check("capture blocked outside 5 m", far["spawnKept"] and far["nothingStored"] and far["stageHidden"])
        check("player told they are too far", "far" in far["toast"].lower(), far["toast"])

    print("\n== 6. capture inside 5 m: 5 s animation, reveal, NEW, rewards ==", flush=True)
    cap = ev("""(async () => {
      const s = SAG.store.activeSpawns()[0];
      SAG.Geo.setFake({ lat: s.lat, lng: s.lng });          // stand on the POI
      const expected = SAG.DB.byId.get(s.speciesId);
      const t0 = performance.now();
      const p = SAG.tryCapture(s);
      await new Promise(r=>setTimeout(r,1500));
      const mid = {
        stageOpen: !document.getElementById('stage').classList.contains('hidden'),
        animShowing: !document.getElementById('stage-anim').classList.contains('hidden'),
        revealHidden: document.getElementById('reveal').classList.contains('hidden'),
        sparkles: document.querySelectorAll('#sparkle-cluster .cs').length,
        creatureHiddenUntilReveal: document.getElementById('anim-img').classList.contains('hidden')
      };
      let revealAt = null;
      for (let i=0;i<100;i++) {
        if (!document.getElementById('reveal').classList.contains('hidden')) { revealAt = performance.now()-t0; break; }
        await new Promise(r=>setTimeout(r,100));
      }
      const card = {
        revealAt: revealAt && Math.round(revealAt),
        name: document.getElementById('reveal-name').textContent,
        type: document.getElementById('reveal-type').textContent,
        stage: document.getElementById('reveal-stage').textContent,
        rarity: document.getElementById('reveal-rarity').textContent,
        img: (document.getElementById('reveal-img').getAttribute('src')||''),
        newShown: !document.getElementById('reveal-new').classList.contains('hidden'),
        newText: document.getElementById('reveal-new').textContent,
        rewards: [...document.querySelectorAll('#reveal-rewards .reward')].map(e=>e.textContent),
        confettiDrawn: (() => { const c=document.getElementById('confetti'); return c.width>0 && c.height>0; })(),
        expected: expected.name, expectedRarity: expected.rarity
      };
      document.getElementById('reveal-ok').click();
      await p;
      const c = SAG.store.s.storage[SAG.store.s.storage.length-1];
      return { mid, ...card,
        stageClosed: document.getElementById('stage').classList.contains('hidden'),
        stored: SAG.store.s.storage.length, level: c.level,
        registered: !!SAG.store.s.registered[c.speciesId],
        candy: SAG.store.candyFor(c.speciesId),
        stardust: SAG.store.s.stardust, xp: SAG.store.s.xp,
        spawnGone: !SAG.store.spawn(s.id), markers: SAG.GameMap.markers.size,
        activeSpawns: SAG.store.activeSpawns().length };
    })()""", timeout=180)
    print("   ", json.dumps(cap), flush=True)
    m = cap["mid"]
    check("stars animate before the reveal", m["stageOpen"] and m["animShowing"] and m["revealHidden"])
    check("creature hidden until the reveal", m["creatureHiddenUntilReveal"] and m["sparkles"] > 0)
    check("reveal lands at about 5 s", 4300 <= cap["revealAt"] <= 6800, f'{cap["revealAt"]} ms')
    check("revealed creature matches the spawn", cap["name"] == cap["expected"], f'{cap["name"]} vs {cap["expected"]}')
    check("card shows name, type, stage and rarity",
          all([cap["name"], cap["type"], cap["stage"], cap["rarity"]]),
          f'{cap["type"]} / {cap["stage"]} / {cap["rarity"]}')
    check("rarity shown matches the CSV", cap["rarity"].startswith(str(cap["expectedRarity"])), cap["rarity"])
    check("creature image used", cap["img"].startswith("images/"), cap["img"])
    check('first capture shows "NEW" + confetti', cap["newShown"] and cap["newText"].upper().startswith("NEW") and cap["confettiDrawn"])
    check("candy, stardust and XP shown as rewards", len(cap["rewards"]) == 3, json.dumps(cap["rewards"]))
    check("creature stored at level 1", cap["stored"] == 1 and cap["level"] == 1)
    check("species registered in the collection", cap["registered"])
    check("candy awarded in 3-8 range", 3 <= cap["candy"] <= 8, str(cap["candy"]))
    check("stardust awarded in 10-50 range", 10 <= cap["stardust"] <= 50, str(cap["stardust"]))
    check("player XP awarded in 2-20 range", 2 <= cap["xp"] <= 20, str(cap["xp"]))
    check("captured spawn removed from state and map",
          cap["spawnGone"] and cap["markers"] == cap["activeSpawns"])
    check("overlay closes after dismissing", cap["stageClosed"])

    print("\n== 7. second capture of a known species shows no NEW ==", flush=True)
    dup = ev("""(async () => {
      const first = SAG.store.s.storage[0].speciesId;
      // force a spawn of the same species next to us
      const m = await import('./js/spawns.js');
      const pos = SAG.Geo.current;
      const sp = m.debugSpawnAt(pos, first);
      SAG.syncMap();
      const p = SAG.tryCapture(sp);
      for (let i=0;i<100;i++){ if(!document.getElementById('reveal').classList.contains('hidden')) break;
        await new Promise(r=>setTimeout(r,100)); }
      const newShown = !document.getElementById('reveal-new').classList.contains('hidden');
      document.getElementById('reveal-ok').click();
      await p;
      const same = SAG.store.s.storage.filter(c=>c.speciesId===first).length;
      return { newShown, copies: same };
    })()""", timeout=120)
    print("   ", json.dumps(dup), flush=True)
    check("duplicate capture does not show NEW", dup["newShown"] is False)
    check("duplicates stored individually", dup["copies"] == 2, str(dup["copies"]))

    print("\n== 8. storage list and sorting ==", flush=True)
    st = ev("""(async () => {
      // top up storage so sorting is meaningful
      const m = await import('./js/spawns.js');
      const pool = ['Elemental Awakening_09','Elemental Awakening_36','Elemental Awakening_64','Elemental Awakening_45'];
      for (const id of pool) {
        const sp = m.debugSpawnAt(SAG.Geo.current, id);
        const p = SAG.tryCapture(sp);
        for (let i=0;i<100;i++){ if(!document.getElementById('reveal').classList.contains('hidden')) break;
          await new Promise(r=>setTimeout(r,100)); }
        document.getElementById('reveal-ok').click();
        await p;
      }
      document.querySelector('.nav-btn[data-view="storage"]').click();
      const nm = () => [...document.querySelectorAll('#storage-grid .cell .nm')].map(e=>e.textContent);
      const pick = v => { const e=document.getElementById('storage-sort'); e.value=v; e.dispatchEvent(new Event('change')); };
      const out = { cells: document.querySelectorAll('#storage-grid .cell').length,
                    total: SAG.store.s.storage.length,
                    countText: document.getElementById('storage-count').textContent,
                    hasLevelBadges: document.querySelectorAll('#storage-grid .cell .lvl').length };
      pick('name');   out.byName = nm();
      pick('rarity'); out.byRarity = [...document.querySelectorAll('#storage-grid .cell .rar')].map(e=>+e.textContent);
      pick('type');   out.byType = [...document.querySelectorAll('#storage-grid .cell .sub')].map(e=>e.textContent);
      pick('id');     out.byId = nm();
      out.idOrder = [...document.querySelectorAll('#storage-grid .cell')].map((c,i)=>i);
      document.getElementById('storage-dir').click();
      out.reversed = nm();
      document.getElementById('storage-dir').click();
      out.restored = nm();
      return out;
    })()""", timeout=300)
    print("   ", json.dumps({k: v for k, v in st.items() if k not in ("idOrder",)}), flush=True)
    check("every stored creature listed individually",
          st["cells"] == st["total"], f'{st["cells"]} cells / {st["total"]} stored')
    check("level badge shown on each entry", st["hasLevelBadges"] == st["cells"])
    check("sort by name", st["byName"] == sorted(st["byName"]), str(st["byName"]))
    check("sort by rarity", st["byRarity"] == sorted(st["byRarity"]), str(st["byRarity"]))
    check("sort by type", st["byType"] == sorted(st["byType"]), str(st["byType"]))
    check("sort direction toggle", st["reversed"] == st["byId"][::-1] and st["restored"] == st["byId"])

    print("\n== 9. creature sheet: candy + shared stardust visible ==", flush=True)
    sheet = ev("""(() => {
      document.querySelector('#storage-grid .cell').click();
      const rows = [...document.querySelectorAll('#sheet-body .det-row')].map(r=>r.textContent);
      const btns = [...document.querySelectorAll('#sheet-body .btn')].map(b=>b.textContent.trim());
      const out = { rows, btns,
        tags: [...document.querySelectorAll('#sheet-body .det-tags .tag')].map(t=>t.textContent) };
      document.querySelector('#sheet .sheet-close').click();
      return out;
    })()""")
    print("   ", json.dumps(sheet), flush=True)
    check("sheet shows family candy", any("candy" in r.lower() for r in sheet["rows"]))
    check("sheet shows shared stardust", any("stardust" in r.lower() and "shared" in r.lower() for r in sheet["rows"]))
    check("sheet shows name/type/stage/rarity/level tags", len(sheet["tags"]) >= 4, json.dumps(sheet["tags"]))
    check("level up and release buttons offered",
          any("Level up" in b for b in sheet["btns"]) and any("Release" in b for b in sheet["btns"]),
          json.dumps(sheet["btns"]))

    print("\n== 10. levelling with stardust ==", flush=True)
    lv = ev("""(() => {
      SAG.store.s.stardust = 6145;   // exactly enough for levels 2..10
      SAG.store.touch('t',{immediate:true});
      const uid = SAG.store.s.storage[0].uid;
      const before = SAG.store.s.stardust;
      const costs = [];
      for (let i=0;i<9;i++) { const r = SAG.store.levelUp(uid); costs.push(r.ok ? r.cost : r.reason); }
      const blocked = SAG.store.levelUp(uid);
      return { costs, level: SAG.store.creature(uid).level,
               spent: before - SAG.store.s.stardust, left: SAG.store.s.stardust,
               blocked: blocked.reason };
    })()""")
    print("   ", json.dumps(lv), flush=True)
    check("level costs follow the table",
          lv["costs"] == [25, 70, 150, 300, 500, 800, 1100, 1400, 1800], json.dumps(lv["costs"]))
    check("stardust deducted exactly", lv["spent"] == 6145, str(lv["spent"]))
    check("creature reaches level 10", lv["level"] == 10, str(lv["level"]))
    check("cannot level past 10", lv["blocked"] == "max", str(lv["blocked"]))
    check("stardust fully consumed", lv["left"] == 0, str(lv["left"]))

    print("\n== 11. evolution: candy, level kept, registration, XP ==", flush=True)
    evo = ev("""(async () => {
      const root = SAG.DB.species.find(s => s.name === 'Chimerasprout'); // 3-stage family
      const r = SAG.store.capture(root.id);
      const uid = r.creature.uid;
      SAG.store.addStardust(200); SAG.store.levelUp(uid); SAG.store.levelUp(uid); // level 3
      SAG.store.s.candy[root.id] = 100; SAG.store.touch('t',{immediate:true});

      const before = { candy: SAG.store.candyFor(root.id), xp: SAG.store.s.xp,
                       regs: Object.keys(SAG.store.s.registered).length };

      // drive it through the real UI path so the animation is exercised
      document.querySelector('.nav-btn[data-view="storage"]').click();
      const pick = v => { const e=document.getElementById('storage-sort'); e.value=v; e.dispatchEvent(new Event('change')); };
      pick('recent');
      const cells = [...document.querySelectorAll('#storage-grid .cell')];
      cells[cells.length-1].click();
      const evoBtn = [...document.querySelectorAll('#sheet-body .btn')].find(b => b.textContent.includes('Evolve'));
      const label = evoBtn.textContent.trim();
      const t0 = performance.now();
      evoBtn.click();
      await new Promise(r=>setTimeout(r,1500));
      const mid = { shaking: !document.getElementById('anim-img').classList.contains('hidden'),
                    imgSrc: document.getElementById('anim-img').getAttribute('src'),
                    revealHidden: document.getElementById('reveal').classList.contains('hidden') };
      let revealAt=null;
      for (let i=0;i<100;i++){ if(!document.getElementById('reveal').classList.contains('hidden')){revealAt=performance.now()-t0;break;}
        await new Promise(r=>setTimeout(r,100)); }
      const card = { revealAt: revealAt && Math.round(revealAt),
                     name: document.getElementById('reveal-name').textContent,
                     newShown: !document.getElementById('reveal-new').classList.contains('hidden'),
                     rewards: [...document.querySelectorAll('#reveal-rewards .reward')].map(e=>e.textContent) };
      document.getElementById('reveal-ok').click();
      await new Promise(r=>setTimeout(r,400));

      // snapshot now: store.creature() hands back the live object, which the
      // next evolution mutates in place
      const mid1 = SAG.store.creature(uid);
      const stage2 = SAG.DB.byId.get(mid1.speciesId).name;
      const level2 = mid1.level;
      const reg2 = !!SAG.store.s.registered[mid1.speciesId];
      // second evolution straight through the store
      const e2 = SAG.store.evolve(uid);
      const c2 = SAG.store.creature(uid);
      return { label, mid, ...card, before,
        stage2, level2, reg2,
        stage3: e2.to.name, level3: c2.level, xp2: e2.xp,
        candyAfter: SAG.store.candyFor(c2.speciesId),
        candyShared: SAG.store.candyFor(root.id) === SAG.store.candyFor(c2.speciesId),
        xpAfter: SAG.store.s.xp,
        regAfter: Object.keys(SAG.store.s.registered).length,
        reg3: !!SAG.store.s.registered[c2.speciesId] };
    })()""", timeout=300)
    print("   ", json.dumps(evo), flush=True)
    check("evolve button states the candy cost", "25" in evo["label"], evo["label"])
    check("old form shakes during the animation",
          evo["mid"]["shaking"] and evo["mid"]["revealHidden"] and "Chimerasprout" in (evo["mid"]["imgSrc"] or ""))
    check("evolution reveal lands at about 5 s", 4300 <= evo["revealAt"] <= 6800, f'{evo["revealAt"]} ms')
    check("evolved into Chimerafluff then Chimereal",
          evo["stage2"] == "Chimerafluff" and evo["stage3"] == "Chimereal")
    check("level 3 kept through both evolutions",
          evo["level2"] == 3 and evo["level3"] == 3, f'{evo["level2"]}/{evo["level3"]}')
    check("candy spent 25 + 50 from the shared family pool",
          evo["before"]["candy"] - evo["candyAfter"] == 75,
          f'{evo["before"]["candy"]} -> {evo["candyAfter"]}')
    check("candy stays attached to the family", evo["candyShared"])
    check("evolution XP 30 then 50", evo["xpAfter"] - evo["before"]["xp"] == 80 and evo["xp2"] == 50,
          str(evo["xpAfter"] - evo["before"]["xp"]))
    check("both evolutions registered", evo["reg2"] and evo["reg3"] and evo["regAfter"] - evo["before"]["regs"] == 2,
          str(evo["regAfter"] - evo["before"]["regs"]))
    check("NEW shown for a first-time evolution", evo["newShown"] is True)

    print("\n== 12. release returns 1 family candy ==", flush=True)
    rel = ev("""(() => {
      const root = SAG.DB.species.find(s=>s.name==='Chimerasprout');
      const c = SAG.store.s.storage.find(x=>SAG.DB.byId.get(x.speciesId).name==='Chimereal');
      const before = SAG.store.candyFor(root.id);
      const n = SAG.store.s.storage.length;
      const r = SAG.store.remove(c.uid);
      return { ok:r.ok, gained: SAG.store.candyFor(root.id) - before,
               removed: SAG.store.s.storage.length === n-1,
               stillRegistered: !!SAG.store.s.registered[c.speciesId] };
    })()""")
    print("   ", json.dumps(rel), flush=True)
    check("releasing a Stage 3 gives 1 Stage 1 family candy", rel["gained"] == 1, str(rel["gained"]))
    check("creature removed from storage", rel["removed"])
    check("collection registration is kept after release", rel["stillRegistered"])

    print("\n== 13. player level curve ==", flush=True)
    pl = ev("""(() => {
      const probe=[0,24,25,99,100,249,250,999,1000,1999,2000,3500,6000,10000,15000,22000,30000,38000,45000,50000,99999];
      const keep = SAG.store.s.xp, out=[];
      for (const xp of probe){ SAG.store.s.xp=xp; out.push([xp, SAG.store.level]); }
      SAG.store.s.xp = keep;
      return out;
    })()""")
    expected = {0:1,24:1,25:2,99:2,100:3,249:3,250:4,999:4,1000:5,1999:5,2000:6,3500:7,
                6000:8,10000:9,15000:10,22000:11,30000:12,38000:13,45000:14,50000:15,99999:15}
    bad = [(xp, lvl) for xp, lvl in pl if expected[xp] != lvl]
    print("   ", pl, flush=True)
    check("XP thresholds map to the documented player levels", not bad, str(bad))

    print("\n== 14. rarity spawn distribution (40k rolls) ==", flush=True)
    dist = ev("""(async () => {
      const m = await import('./js/data.js');
      const c={1:0,2:0,3:0,4:0,5:0}; const stages=new Set(); const N=40000;
      for(let i=0;i<N;i++){ const s=m.rollSpawnSpecies(); c[s.rarity]++; stages.add(s.stage); }
      return { pct: Object.fromEntries(Object.entries(c).map(([k,v])=>[k,+(100*v/N).toFixed(2)])),
               stages:[...stages] };
    })()""", timeout=120)
    print("   ", json.dumps(dist), flush=True)
    p = dist["pct"]
    check("common ~60%", abs(p["1"] - 60) < 1.5, f'{p["1"]}%')
    check("uncommon ~28%", abs(p["2"] - 28) < 1.5, f'{p["2"]}%')
    check("rare ~8%", abs(p["3"] - 8) < 1.0, f'{p["3"]}%')
    check("epic ~3%", abs(p["4"] - 3) < 0.8, f'{p["4"]}%')
    check("legendary ~1%", abs(p["5"] - 1) < 0.5, f'{p["5"]}%')
    check("only Stage 1 rolls", dist["stages"] == [1])

    print("\n== 15. reward ranges over 5k captures ==", flush=True)
    rw = ev("""(async () => {
      const m = await import('./js/data.js');
      const rng = {};
      for (const r of [1,2,3,4,5]) {
        let cmin=99,cmax=0,dmin=999,dmax=0;
        for (let i=0;i<5000;i++){
          const c=m.candyForCapture(r), d=m.dustForCapture(r);
          cmin=Math.min(cmin,c); cmax=Math.max(cmax,c);
          dmin=Math.min(dmin,d); dmax=Math.max(dmax,d);
        }
        rng[r]={candy:[cmin,cmax],dust:[dmin,dmax],xp:m.xpForCapture(r)};
      }
      return rng;
    })()""", timeout=120)
    print("   ", json.dumps(rw), flush=True)
    exp = {"1": {"candy": [3, 5], "dust": [10, 15], "xp": 2},
           "2": {"candy": [3, 6], "dust": [12, 18], "xp": 3},
           "3": {"candy": [4, 6], "dust": [15, 20], "xp": 5},
           "4": {"candy": [5, 7], "dust": [20, 30], "xp": 10},
           "5": {"candy": [6, 8], "dust": [30, 50], "xp": 20}}
    for k, v in exp.items():
        check(f"rarity {k} rewards match the spec", rw[k] == v, json.dumps(rw[k]))

    print("\n== 16. rules constants ==", flush=True)
    cad = ev("""(async () => {
      const m = await import('./js/data.js');
      const sp = await import('./js/spawns.js');
      return { chance:m.RULES.SPAWN_CHANCE, interval:m.RULES.SCAN_INTERVAL_MS,
               minLife:m.RULES.SPAWN_MIN_MS, maxLife:m.RULES.SPAWN_MAX_MS,
               sep:m.RULES.MIN_SPAWN_SEPARATION_M, range:m.RULES.CAPTURE_RANGE_M,
               radius:m.RULES.SCAN_RADIUS_M, anim:m.RULES.CAPTURE_ANIM_MS,
               label: document.getElementById('next-scan').textContent,
               untilNext: sp.msUntilNextScan() };
    })()""", timeout=60)
    print("   ", json.dumps(cad), flush=True)
    check("30% spawn chance", cad["chance"] == 0.3)
    check("10 minute re-scan interval", cad["interval"] == 600000)
    check("10-20 minute spawn lifetime", cad["minLife"] == 600000 and cad["maxLife"] == 1200000)
    check("5 m separation and 5 m capture range", cad["sep"] == 5 and cad["range"] == 5)
    check("100 m scan radius", cad["radius"] == 100)
    check("5 second animations", cad["anim"] == 5000)
    check("next-scan countdown displayed", ":" in cad["label"], cad["label"])
    check("next scan due within 10 minutes", 0 <= cad["untilNext"] <= 600000, str(cad["untilNext"]))

    print("\n== 17. a POI can respawn only after its spawn is gone ==", flush=True)
    resp = ev("""(async () => {
      // pick a POI that currently holds a spawn, rescan at 100% and confirm no duplicate
      const before = SAG.store.activeSpawns();
      const poi = before[0]?.poiId;
      await SAG.doScan({ chance: 1, force: false, reason: 'respawn test' });
      const mid = SAG.store.activeSpawns();
      const dupWhileOccupied = mid.filter(s=>s.poiId===poi).length;
      // now expire that spawn and rescan
      const target = mid.find(s=>s.poiId===poi);
      target.expiresAt = Date.now() - 1;
      SAG.store.pruneExpired();
      SAG.syncMap();
      const goneCount = SAG.store.activeSpawns().filter(s=>s.poiId===poi).length;
      await SAG.doScan({ chance: 1, force: false, reason: 'respawn test 2' });
      const afterCount = SAG.store.activeSpawns().filter(s=>s.poiId===poi).length;
      return { poi, dupWhileOccupied, goneCount, afterCount,
               uniquePois: new Set(SAG.store.activeSpawns().map(s=>s.poiId)).size ===
                           SAG.store.activeSpawns().length };
    })()""", timeout=240)
    print("   ", json.dumps(resp), flush=True)
    check("occupied POI does not get a second spawn", resp["dupWhileOccupied"] == 1, str(resp["dupWhileOccupied"]))
    check("POI is free after its spawn expires", resp["goneCount"] == 0)
    check("POI can spawn again on the next check", resp["afterCount"] == 1, str(resp["afterCount"]))
    check("still one spawn per POI overall", resp["uniquePois"])

    print("\n== 18. despawn clears the marker instantly ==", flush=True)
    de = ev("""(async () => {
      const s = SAG.store.activeSpawns()[0];
      if (!s) return { skipped:true };
      const id = s.id, before = SAG.GameMap.markers.size;
      s.expiresAt = Date.now() + 1000;
      await new Promise(r=>setTimeout(r,2500));
      return { skipped:false, before, after: SAG.GameMap.markers.size,
               listed: !!SAG.store.spawn(id),
               countText: document.getElementById('spawn-count').textContent };
    })()""", timeout=60)
    print("   ", json.dumps(de), flush=True)
    if not de.get("skipped"):
        check("expired spawn dropped from state", de["listed"] is False)
        check("expired marker removed from the map", de["after"] == de["before"] - 1,
              f'{de["before"]} -> {de["after"]}')

    print("\n== 19. progress survives closing and reopening the game ==", flush=True)
    snap = ev("""(async () => {
      await SAG.store.flush();
      return { storage: SAG.store.s.storage.length, xp: SAG.store.s.xp, dust: SAG.store.s.stardust,
               spawns: SAG.store.activeSpawns().length,
               registered: Object.keys(SAG.store.s.registered).length,
               candyKeys: Object.keys(SAG.store.s.candy).length,
               levels: SAG.store.s.storage.map(c=>c.level).join(',') };
    })()""", timeout=60)
    print("    before reload:", json.dumps(snap), flush=True)
    ws.call("Page.reload", {"ignoreCache": False})
    time.sleep(2)
    ok = False
    for _ in range(80):
        try:
            ok = ev("!!(window.SAG && document.getElementById('boot').classList.contains('hidden'))", timeout=30)
        except Exception:
            ok = False
        if ok:
            break
        time.sleep(0.5)
    check("game re-boots after a reload", ok)
    after = ev("""(() => ({
      storage: SAG.store.s.storage.length, xp: SAG.store.s.xp, dust: SAG.store.s.stardust,
      spawns: SAG.store.activeSpawns().length,
      registered: Object.keys(SAG.store.s.registered).length,
      candyKeys: Object.keys(SAG.store.s.candy).length,
      levels: SAG.store.s.storage.map(c=>c.level).join(','),
      markers: SAG.GameMap.markers.size, loadedFrom: SAG.store.loadedFrom,
      fake: SAG.Geo.usingFake, sortPref: SAG.store.s.ui.storageSort
    }))()""")
    print("    after reload: ", json.dumps(after), flush=True)
    check("storage survived", after["storage"] == snap["storage"], f'{after["storage"]}/{snap["storage"]}')
    check("creature levels survived", after["levels"] == snap["levels"])
    check("XP and stardust survived", after["xp"] == snap["xp"] and after["dust"] == snap["dust"])
    check("registrations survived", after["registered"] == snap["registered"])
    check("candy survived", after["candyKeys"] == snap["candyKeys"])
    check("live spawns survived", after["spawns"] == snap["spawns"], f'{after["spawns"]}/{snap["spawns"]}')
    check("spawn markers restored on the map", after["markers"] == after["spawns"])
    check("debug location restored", after["fake"] is True)
    check("save came from persistent storage", after["loadedFrom"] in ("idb", "file"), after["loadedFrom"])

    print("\n== 20. backup export / import round trip ==", flush=True)
    rt = ev("""(async () => {
      const json = JSON.stringify(SAG.store.s);
      const before = { st: SAG.store.s.storage.length, xp: SAG.store.s.xp };
      await SAG.store.reset();
      const wiped = { st: SAG.store.s.storage.length, xp: SAG.store.s.xp };
      await SAG.store.replace(JSON.parse(json));
      return { before, wiped, restored: { st: SAG.store.s.storage.length, xp: SAG.store.s.xp },
               fsSupported: SAG.Persist.supportsFS, persisted: SAG.Persist.persisted };
    })()""", timeout=90)
    print("   ", json.dumps(rt), flush=True)
    check("reset clears progress", rt["wiped"]["st"] == 0 and rt["wiped"]["xp"] == 0)
    check("backup import restores progress", rt["restored"] == rt["before"])
    check("File System Access API available for device saves", rt["fsSupported"] is True)

    print("\n== console / page errors ==", flush=True)
    try:
        ws.sock.settimeout(2)
        while True:
            ws.events.append(json.loads(ws.recv_text()))
    except Exception:
        pass
    seen = []
    for e in ws.events:
        if e.get("method") == "Log.entryAdded":
            en = e["params"]["entry"]
            if en.get("level") in ("error",):
                seen.append(f'{en.get("level")}: {en.get("text","")[:160]} @ {(en.get("url") or "")[-60:]}')
        if e.get("method") == "Runtime.exceptionThrown":
            d = e["params"]["exceptionDetails"]
            seen.append("exception: " + str((d.get("exception") or {}).get("description") or d.get("text"))[:220])
    # Upstream OSM/Overpass hiccups are handled by the game (mirror fallback), so
    # they are not code defects.
    ignorable = ("tile.openstreetmap", "favicon", "manifest", "Geolocation", "geolocation",
                 "/vendor/leaflet/images/", "ERR_INTERNET_DISCONNECTED",
                 "overpass", "maps.mail.ru")
    real = [s for s in seen if not any(k in s for k in ignorable)]
    for s in seen[:25]:
        print("   ", s, flush=True)
    check("no unexpected console errors", not real, json.dumps(real[:3]))

finally:
    print("\n" + "=" * 62, flush=True)
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
    else:
        print("ALL CHECKS PASSED")
    print("=" * 62, flush=True)
    if ws:
        ws.close()
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

sys.exit(1 if failures else 0)
