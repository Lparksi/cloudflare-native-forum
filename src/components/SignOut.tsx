import { useState } from 'react';
import { authClient } from '../auth/client';
export default function SignOut() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) setError(true);
      else window.location.assign('/login');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="button" onClick={signOut} disabled={busy}>
        {busy ? '退出中…' : '退出登录'}
      </button>
      {error && (
        <p className="error" role="alert">
          退出失败，请重试。
        </p>
      )}
    </div>
  );
}
