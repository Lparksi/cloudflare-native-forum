import { useState } from 'react';
export default function ReadNotification({ id }: { id: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function read() {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.ok) window.location.reload();
      else setMessage('通知已移除或无法操作，请刷新。');
    } catch {
      setMessage('操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => void read()}
      >
        标记已读
      </button>
      {message && <p role="status">{message}</p>}
    </>
  );
}
