import initialize from '../vendor/webp/codec.js';
import wasm from '../vendor/webp/codec.wasm?module';
// Compiled at build time by Workers; no dynamic WASM compilation or network fetch.
const codec = await initialize({
  instantiateWasm(imports, callback) {
    const instance = new WebAssembly.Instance(wasm, imports);
    callback(instance);
    return instance.exports;
  },
});
export function decodeWebp(buffer: ArrayBuffer) {
  const input = codec._malloc(buffer.byteLength),
    widthPtr = codec._malloc(4),
    heightPtr = codec._malloc(4);
  let output = 0;
  try {
    codec.HEAPU8.set(new Uint8Array(buffer), input);
    output = codec._webp_decode_rgba(
      input,
      buffer.byteLength,
      widthPtr,
      heightPtr,
    );
    if (!output) throw new Error('Invalid WebP bitstream');
    return {
      width: codec.HEAPU32[widthPtr >> 2]!,
      height: codec.HEAPU32[heightPtr >> 2]!,
    };
  } finally {
    if (output) codec._webp_free(output);
    codec._free(input);
    codec._free(widthPtr);
    codec._free(heightPtr);
  }
}
