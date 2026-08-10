import json, os, time, traceback
from _cdp_lib import launch, WS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_probe_result.json")
log = {"steps": []}


def w():
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2)


def step(name, value):
    log["steps"].append({name: value})
    w()


proc = None
ws = None
try:
    proc, target = launch("http://127.0.0.1:8123/index.html", port=9340, profile_name="sag-probe2")
    step("attached", target.get("url"))
    ws = WS(target["webSocketDebuggerUrl"])
    ws.call("Runtime.enable", timeout=30)
    step("runtime", "enabled")

    booted = False
    for _ in range(60):
        booted = ws.evaluate("!!window.SAG", timeout=30)
        if booted:
            break
        time.sleep(0.5)
    step("booted", booted)

    for url in [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]:
        expr = (
            r"""(async () => {
  const q = '[out:json][timeout:20];(nwr["shop"](around:100,51.5152,-0.1419);nwr["amenity"](around:100,51.5152,-0.1419););out tags center;';
  const body = 'data=' + encodeURIComponent(q);
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(URL_HERE, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body, signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return { status:r.status, ms:Math.round(performance.now()-t0), body:(await r.text()).slice(0,180) };
    const j = await r.json();
    return { status:r.status, ms:Math.round(performance.now()-t0), elements:(j.elements||[]).length,
             sample:(j.elements||[]).slice(0,3).map(e=>({t:e.type, tags:Object.keys(e.tags||{}).slice(0,4)})) };
  } catch (e) { return { error:String(e).slice(0,180), ms:Math.round(performance.now()-t0) }; }
})()""".replace("URL_HERE", json.dumps(url))
        )
        try:
            res = ws.evaluate(expr, timeout=90)
        except Exception as e:
            res = {"pyerror": str(e)}
        step(url, res)

except Exception:
    log["traceback"] = traceback.format_exc()
    w()
finally:
    log["done"] = True
    w()
    if ws:
        ws.close()
    if proc:
        proc.terminate()
