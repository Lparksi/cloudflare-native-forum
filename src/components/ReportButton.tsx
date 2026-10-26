import { useState, type SubmitEvent } from 'react';
import Challenge from './Challenge';
export default function ReportButton({
  kind,
  id,
}: {
  kind: 'topic' | 'reply';
  id: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(''),
    [version, setVersion] = useState(0),
    [message, setMessage] = useState('');
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-turnstile-token': token,
        },
        body: JSON.stringify({ kind, targetId: id, reason }),
      });
      const result = (await response.json()) as
        { data: unknown } | { error: { message: string } };
      if ('error' in result) setMessage(result.error.message);
      else {
        setOpen(false);
        setMessage('举报已提交，等待审核。');
      }
    } catch {
      setMessage('提交失败，请重试。');
    } finally {
      setBusy(false);
      setToken('');
      setVersion((v) => v + 1);
    }
  }
  return (
    <div className="report-control">
      {!open && (
        <button className="text-button" onClick={() => setOpen(true)}>
          举报{kind === 'topic' ? '主题' : '回复'}
        </button>
      )}
      {open && (
        <form onSubmit={submit} className="composer">
          <label>
            举报原因
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
            />
          </label>
          <Challenge action="report" version={version} onToken={setToken} />
          <button className="button" disabled={busy || !token}>
            提交举报
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setOpen(false)}
          >
            取消
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
