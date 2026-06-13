function formatUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export function createUuid(): string {
  const webCrypto = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    try {
      webCrypto.getRandomValues(bytes);
      return formatUuid(bytes);
    } catch {
      // Continue to the compatibility fallback for restricted browser contexts.
    }
  }

  let seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  for (let index = 0; index < bytes.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    bytes[index] = (seed >>> 16) ^ Math.floor(Math.random() * 256);
  }
  return formatUuid(bytes);
}
