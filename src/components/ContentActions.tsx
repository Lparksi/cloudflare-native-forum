import { useState } from 'react';
export default function ContentActions({
  kind,
  id,
  revision,
}: {
  kind: 'topic' | 'reply';
  id: string;
  revision: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = kind === 'topic' ? '主题' : '回复';
  async function remove() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/${kind === 'topic' ? 'topics' : 'replies'}/${id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision }),
        },
      );
      const result = (await response.json()) as
        { data: unknown } | { error: { message: string } };
      if ('error' in result) {
        setError(result.error.message);
        return;
      }
      if (kind === 'topic') window.location.assign('/');
      else window.location.reload();
    } catch {
      setError('操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-actions">
      {confirming ? (
        <>
          <span>确认删除此{label}？</span>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            确认删除{label}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            取消
          </button>
        </>
      ) : (
        <>
          <a href={kind === 'topic' ? `/t/${id}/edit` : `/replies/${id}/edit`}>
            编辑{label}
          </a>
          <button
            className="text-button danger"
            onClick={() => setConfirming(true)}
          >
            删除{label}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
