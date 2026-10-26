type WebpCodec = {
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _webp_free(pointer: number): void;
  _webp_decode_rgba(
    input: number,
    bytes: number,
    width: number,
    height: number,
  ): number;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
};
export default function initialize(options: {
  instantiateWasm: (
    imports: WebAssembly.Imports,
    callback: (instance: WebAssembly.Instance) => void,
  ) => WebAssembly.Exports;
}): Promise<WebpCodec>;
