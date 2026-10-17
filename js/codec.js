/* ============================================================
   codec.js — packing a save into a small text blob, and back

   A save is mostly repetitive JSON, so gzip shrinks it about tenfold. That is
   the difference between a cloud backup that fits in one Firestore document
   (1 MiB at most) and one that silently fails every day, and it lets a second
   local copy fit comfortably in localStorage.

   Packed text is "SGZ1:" followed by base64 of the gzip bytes. The prefix makes
   it unambiguous on import, so a player can paste one into a file and load it.
   ============================================================ */

export const PACK_PREFIX = 'SGZ1:';

const canCompress = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Uint8Array -> base64, in slices so a multi-megabyte save cannot blow the stack. */
function bytesToBase64(bytes) {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * JSON text -> packed text. Falls back to the plain JSON when the browser has
 * no CompressionStream, which `unpackText` reads just the same.
 */
export async function packText(json) {
  if (!canCompress()) return json;
  const gz = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
  return PACK_PREFIX + bytesToBase64(gz);
}

/** Packed text (or plain JSON) -> JSON text. Throws if it is neither. */
export async function unpackText(text) {
  let t = String(text ?? '').trim();
  // A value copied out of the Firebase console can arrive wrapped in quotes.
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  if (t.startsWith('{')) return t;
  // Accept the bare base64 too: "H4sI" is how every gzip stream starts.
  const b64 = t.startsWith(PACK_PREFIX) ? t.slice(PACK_PREFIX.length) : t.startsWith('H4sI') ? t : null;
  if (b64 == null) throw new Error('not a save');
  if (!canCompress()) throw new Error('This browser cannot unpack compressed saves');
  const raw = await pipe(base64ToBytes(b64.replace(/\s+/g, '')), new DecompressionStream('gzip'));
  return new TextDecoder().decode(raw);
}

/** Whether a string is nothing at all: empty, whitespace or NUL bytes. */
export const isBlankText = text => !String(text ?? '').replace(/[\s\u0000]+/g, '');
