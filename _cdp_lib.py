"""Minimal DevTools Protocol client over a hand-rolled WebSocket (temporary test helper)."""
import base64, json, os, socket, struct, subprocess, shutil, tempfile, time, urllib.request

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("no Chrome/Edge found")


class WS:
    def __init__(self, url, timeout=90):
        rest = url[5:]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("handshake failed")
            buf += chunk
        head, _, tail = buf.partition(b"\r\n\r\n")
        if b" 101" not in head.split(b"\r\n")[0]:
            raise ConnectionError("bad handshake: " + head[:120].decode("latin1"))
        self.buf = tail
        self._id = 0
        self.events = []

    # ---- framing ----
    def _recv(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 16)
            if not chunk:
                raise ConnectionError("socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, text, opcode=0x1):
        payload = text.encode()
        h = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            h.append(0x80 | n)
        elif n < 1 << 16:
            h.append(0x80 | 126)
            h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127)
            h += struct.pack(">Q", n)
        mask = os.urandom(4)
        h += mask
        self.sock.sendall(bytes(h) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _read_frame(self):
        b1, b2 = self._recv(2)
        fin = b1 & 0x80
        opcode = b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._recv(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._recv(8))[0]
        data = self._recv(n) if n else b""
        return fin, opcode, data

    def recv_text(self):
        frames = b""
        while True:
            fin, opcode, data = self._read_frame()
            if opcode == 0x9:  # ping -> pong
                self._send(data.decode("latin1"), opcode=0xA)
                continue
            if opcode == 0x8:
                raise ConnectionError("closed by peer")
            if opcode in (0x1, 0x0):
                frames += data
                if fin:
                    return frames.decode("utf-8", "replace")
                continue
            # ignore binary/pong

    # ---- protocol ----
    def call(self, method, params=None, timeout=120):
        self._id += 1
        mid = self._id
        self._send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.sock.settimeout(max(1, deadline - time.time()))
            msg = json.loads(self.recv_text())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)
        raise TimeoutError(f"{method} timed out")

    def evaluate(self, expr, timeout=120, await_promise=True):
        r = self.call(
            "Runtime.evaluate",
            {
                "expression": expr,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
            timeout=timeout,
        )
        if r.get("exceptionDetails"):
            d = r["exceptionDetails"]
            raise RuntimeError("JS: " + str((d.get("exception") or {}).get("description") or d.get("text")))
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def launch(url, port=9333, profile_name="sag-cdp"):
    profile = os.path.join(tempfile.gettempdir(), profile_name)
    shutil.rmtree(profile, ignore_errors=True)
    proc = subprocess.Popen(
        [
            find_chrome(),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=Translate",
            "--window-size=420,880",
            f"--user-data-dir={profile}",
            f"--remote-debugging-port={port}",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    target = None
    for _ in range(120):
        try:
            data = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3).read())
            pages = [t for t in data if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            match = [t for t in pages if url.split("://")[1].split("/")[0] in (t.get("url") or "")]
            if match:
                target = match[0]
                break
            if pages:
                target = pages[0]
        except Exception:
            pass
        time.sleep(0.4)
    if not target:
        proc.terminate()
        raise SystemExit("could not attach to a page target")
    return proc, target
