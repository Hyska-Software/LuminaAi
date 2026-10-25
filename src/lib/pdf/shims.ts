/**
 * PDF.js 6 relies on the ES2026 `Uint8Array` byte helpers (`toHex`, `toBase64`
 * and `fromBase64`). Chromium 140+ / Safari 26+ ship them natively, but the
 * WebView runtime of a desktop app (WebView2/WebKitGTK) can be older and the
 * Node/jsdom used by the tests definitely does not have them. They are trivial
 * helpers used only inside pdf.js, so installing them before the dynamic
 * `import('pdfjs-dist')` is cheaper than requiring a newer runtime.
 */

type ByteArrayStatics = {
  fromBase64?: (value: string) => Uint8Array;
};

type ByteArrayPrototype = {
  toHex?: () => string;
  toBase64?: () => string;
};

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

let installed = false;

/** Installs the byte helpers pdf.js expects when the runtime lacks them. */
export function ensurePdfJsByteHelpers(): void {
  if (installed) return;
  installed = true;

  const prototype = Uint8Array.prototype as unknown as ByteArrayPrototype;
  if (typeof prototype.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value: function toHex(this: Uint8Array): string {
        return bytesToHex(this);
      },
      writable: true,
      configurable: true,
    });
  }
  if (typeof prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value: function toBase64(this: Uint8Array): string {
        return bytesToBase64(this);
      },
      writable: true,
      configurable: true,
    });
  }

  const statics = Uint8Array as unknown as ByteArrayStatics;
  if (typeof statics.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value: function fromBase64(value: string): Uint8Array {
        return base64ToBytes(value);
      },
      writable: true,
      configurable: true,
    });
  }
}
