import { useState } from 'react';
import ImageUpload from './ImageUpload';
export default function MarkdownEditor({
  label = '正文',
  defaultValue = '',
}: {
  label?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function preview() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/markdown/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: value }),
      });
      const result = (await response.json()) as
        { data: { html: string } } | { error: { message: string } };
      if ('error' in result) setError(result.error.message);
      else setHtml(result.data.html);
    } catch {
      setError('预览失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="markdown-editor">
      <label>
        {label}
        <textarea
          name="body"
          aria-label={label}
          required
          maxLength={20000}
          rows={10}
          value={value}
          readOnly={busy}
          onChange={(e) => {
            setValue(e.target.value);
            setHtml(null);
          }}
        />
      </label>
      <div className="editor-toolbar">
        <span className="muted">
          支持 Markdown、表格与代码块；不接受原始 HTML。
        </span>
        <button
          type="button"
          className="text-button"
          disabled={busy || !value.trim()}
          onClick={() => (html === null ? void preview() : setHtml(null))}
        >
          {busy ? '生成预览…' : html === null ? '预览 Markdown' : '收起预览'}
        </button>
      </div>
      <ImageUpload
        kind="image"
        onUploaded={(image) => {
          setValue((current) => `${current}\n\n![图片](${image.url})\n`);
          setHtml(null);
        }}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {html !== null && (
        <div
          className="markdown preview"
          aria-label="Markdown 预览"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
