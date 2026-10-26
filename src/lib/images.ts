import { decodeWebp } from './webp-codec';
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export class InvalidImage extends Error {
  constructor() {
    super(
      '图片无效：仅支持静态 WebP，正文最长边 1600，头像须为 256×256；文件最大 2 MiB。',
    );
  }
}
const tag = (data: Uint8Array, offset: number) =>
  String.fromCharCode(...data.subarray(offset, offset + 4));
// Validate sizes before decoding. Drop all metadata; never store client filenames.
export async function validateImage(
  buffer: ArrayBuffer,
  kind: 'avatar' | 'image',
) {
  const data = new Uint8Array(buffer),
    view = new DataView(buffer);
  const invalid = () => {
    throw new InvalidImage();
  };
  if (
    data.length < 20 ||
    data.length > MAX_UPLOAD_BYTES ||
    tag(data, 0) !== 'RIFF' ||
    tag(data, 8) !== 'WEBP' ||
    view.getUint32(4, true) + 8 !== data.length
  )
    invalid();
  const chunks: Uint8Array[] = [];
  const seen = new Set<string>();
  let width = 0,
    height = 0,
    canvasWidth = 0,
    canvasHeight = 0,
    codec = '';
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) invalid();
    const type = tag(data, offset),
      size = view.getUint32(offset + 4, true),
      end = offset + 8 + size + (size % 2),
      start = offset + 8;
    if (end > data.length || seen.has(type)) invalid();
    seen.add(type);
    if (type === 'VP8X') {
      if (offset !== 12 || size !== 10 || data[start]! & 0x02) invalid();
      canvasWidth =
        1 +
        data[start + 4]! +
        (data[start + 5]! << 8) +
        (data[start + 6]! << 16);
      canvasHeight =
        1 +
        data[start + 7]! +
        (data[start + 8]! << 8) +
        (data[start + 9]! << 16);
      const chunk = data.slice(offset, end);
      chunk[8] = chunk[8]! & 0x10; // keep alpha, strip ICC/EXIF/XMP flags
      chunks.push(chunk);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (codec) invalid();
      codec = type;
      if (type === 'VP8 ') {
        if (
          size < 10 ||
          data[start]! & 1 ||
          data[start + 3] !== 0x9d ||
          data[start + 4] !== 0x01 ||
          data[start + 5] !== 0x2a
        )
          invalid();
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else {
        if (size < 5 || data[start] !== 0x2f) invalid();
        const bits = view.getUint32(start + 1, true);
        if (bits >>> 29) invalid();
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      }
      chunks.push(data.slice(offset, end));
    } else if (type === 'ALPH') {
      if (!seen.has('VP8X') || codec || !size) invalid();
      chunks.push(data.slice(offset, end));
    } else if (!['ICCP', 'EXIF', 'XMP '].includes(type)) invalid();
    offset = end;
  }
  if (
    !codec ||
    width < 1 ||
    height < 1 ||
    width > 1600 ||
    height > 1600 ||
    (canvasWidth && (canvasWidth !== width || canvasHeight !== height)) ||
    (kind === 'avatar' && (width !== 256 || height !== 256)) ||
    (seen.has('ALPH') && codec !== 'VP8 ')
  )
    invalid();
  const output = new Uint8Array(
    12 + chunks.reduce((sum, c) => sum + c.length, 0),
  );
  output.set(data.subarray(0, 12));
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  let offset = 12;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const decoded = decodeWebp(output.buffer);
    if (decoded.width !== width || decoded.height !== height) invalid();
  } catch {
    invalid();
  }
  return { data: output, width, height };
}
