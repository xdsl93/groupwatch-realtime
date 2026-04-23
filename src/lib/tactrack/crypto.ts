// AES-GCM end-to-end encryption for room messages.

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// URL-safe base64
export function b64url(buf: ArrayBuffer): string {
  return b64encode(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return b64decode(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return b64url(raw);
}

export function normalizeKeyB64(input: string): string {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // Already decoded or not URI-encoded.
  }

  // Some QR/URL parsers may convert "+" into spaces.
  if (s.includes(" ") && !s.includes("+")) {
    s = s.replace(/ /g, "+");
  }

  // Remove line breaks and accidental separators.
  return s.replace(/\s+/g, "").replace(/[^A-Za-z0-9+/_=-]/g, "");
}

export async function importKey(b64: string): Promise<CryptoKey> {
  const raw = b64urlDecode(normalizeKeyB64(b64));
  return crypto.subtle.importKey(
    "raw",
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJSON(key: CryptoKey, obj: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out.buffer);
}

export async function decryptJSON<T = unknown>(key: CryptoKey, b64: string): Promise<T> {
  const buf = b64urlDecode(b64);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const iv = ab.slice(0, 12);
  const ct = ab.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export function randomCode(len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
