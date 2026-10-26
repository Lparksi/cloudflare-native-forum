import { useEffect, useState } from 'react';
import { compressImage } from '../lib/compress-image';
export type UploadedImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
};
export default function ImageUpload({
  kind,
  onUploaded,
}: {
  kind: 'avatar' | 'image';
  onUploaded: (image: UploadedImage) => void;
}) {
  const [prepared, setPrepared] = useState<Awaited<
      ReturnType<typeof compressImage>
    > | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState('');
  useEffect(() => {
    if (!prepared) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(prepared.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);
  async function prepare(file: File) {
    setBusy(true);
    setPrepared(null);
    setMessage('正在压缩…');
    try {
      setPrepared(await compressImage(file, kind));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '压缩失败');
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/uploads/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: prepared!.blob,
      });
      const result = (await response.json()) as
        { data: UploadedImage } | { error: { message: string } };
      if ('error' in result) setMessage(result.error.message);
      else {
        onUploaded(result.data);
        setPrepared(null);
        setMessage('上传完成。图片链接公开可读。');
      }
    } catch {
      setMessage('上传失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} className="image-upload">
      <label>
        {kind === 'avatar' ? '选择头像' : '选择正文图片'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void prepare(file);
          }}
        />
      </label>
      <p className="muted">
        自动压缩为 WebP；
        {kind === 'avatar' ? '居中裁剪为 256×256' : '最长边 1600'}
        。上传后图片链接公开可读。
      </p>
      {prepared && (
        <>
          <img className="upload-preview" src={preview} alt="待上传预览" />
          <p>
            {prepared.width}×{prepared.height} · WebP ·{' '}
            {(prepared.blob.size / 1024).toFixed(1)} KiB
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => void upload()}
          >
            上传{kind === 'avatar' ? '头像' : '图片'}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
