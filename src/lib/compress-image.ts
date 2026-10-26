// Browser only: native decoding handles EXIF orientation; canvas output drops metadata.
export async function compressImage(file: File, kind: 'avatar' | 'image') {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('请选择 10 MiB 以内的 PNG、JPEG 或静态 WebP 图片。');
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  try {
    if (bitmap.width * bitmap.height > 24000000)
      throw new Error('原图最多 2400 万像素，请先缩小图片。');
    const canvas = document.createElement('canvas'),
      avatar = kind === 'avatar';
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = avatar ? 256 : Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = avatar
      ? 256
      : Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!;
    if (avatar) {
      const size = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - size) / 2,
        (bitmap.height - size) / 2,
        size,
        size,
        0,
        0,
        256,
        256,
      );
    } else context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error('浏览器无法压缩此图片。')),
        'image/webp',
        0.82,
      ),
    );
    if (blob.type !== 'image/webp')
      throw new Error('当前浏览器不支持 WebP 编码，请更换浏览器。');
    if (blob.size > 2 * 1024 * 1024)
      throw new Error('压缩后仍超过 2 MiB，请先缩小原图。');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
