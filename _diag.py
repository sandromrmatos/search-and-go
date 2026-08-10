import json, time, sys
from _cdp_lib import launch, WS

proc, target = launch("http://127.0.0.1:8123/index.html", port=9334, profile_name="sag-diag")
ws = WS(target["webSocketDebuggerUrl"])
ws.call("Runtime.enable", timeout=20)
ws.call("Log.enable", timeout=20)

for i in range(40):
    ok = ws.evaluate("!!window.SAG", timeout=20)
    if ok:
        break
    time.sleep(0.5)

time.sleep(2)
print("BOOT HTML >>>")
print(ws.evaluate("document.getElementById('boot').innerText", timeout=20))
print("<<<")

# drain events for console errors
try:
    ws.sock.settimeout(2)
    while True:
        msg = json.loads(ws.recv_text())
        ws.events.append(msg)
except Exception:
    pass

for e in ws.events:
    if e.get("method") == "Log.entryAdded":
        en = e["params"]["entry"]
        print(f'[{en.get("level")}] {en.get("text")} @ {en.get("url")}:{en.get("lineNumber")}')
    if e.get("method") == "Runtime.exceptionThrown":
        d = e["params"]["exceptionDetails"]
        print("[exception]", (d.get("exception") or {}).get("description") or d.get("text"))

ws.close()
proc.terminate()
