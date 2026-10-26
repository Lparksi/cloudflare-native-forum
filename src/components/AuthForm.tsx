import { useState, type SubmitEvent } from 'react';
import { authClient } from '../auth/client';
export type AuthMode = 'register' | 'login' | 'forgot' | 'reset' | 'resend';
const labels: Record<AuthMode, string> = {
  register: '创建账户',
  login: '登录',
  forgot: '发送重置邮件',
  reset: '设置新密码',
  resend: '重发验证邮件',
};
export default function AuthForm({
  mode,
  token,
}: {
  mode: AuthMode;
  token?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      const result =
        mode === 'register'
          ? await authClient.signUp.email({
              name: String(form.get('name')),
              email,
              password,
              callbackURL: '/login?verified=1',
            })
          : mode === 'login'
            ? await authClient.signIn.email({ email, password })
            : mode === 'forgot'
              ? await authClient.requestPasswordReset({
                  email,
                  redirectTo: '/reset-password',
                })
              : mode === 'resend'
                ? await authClient.sendVerificationEmail({
                    email,
                    callbackURL: '/login?verified=1',
                  })
                : await authClient.resetPassword({
                    token,
                    newPassword: password,
                  });
      if (result.error) {
        const code = result.error.code;
        setError(
          code === 'EMAIL_NOT_VERIFIED'
            ? '请先验证邮箱；可使用下方链接重发验证邮件。'
            : code === 'INVALID_EMAIL_OR_PASSWORD'
              ? '邮箱或密码不正确。'
              : code === 'INVALID_TOKEN'
                ? '链接无效或已过期，请重新申请。'
                : result.error.status === 429
                  ? '操作过于频繁，请稍后再试。'
                  : '操作未完成，请检查输入或重新申请链接。',
        );
        return;
      }
      if (mode === 'login') {
        window.location.assign('/settings');
        return;
      }
      if (mode === 'reset') {
        // Do not leave the reset token in browser history after success.
        window.history.replaceState({}, '', '/reset-password');
        setMessage('密码已更新，旧会话已退出，请重新登录。');
      } else
        setMessage(
          '如果该邮箱符合条件，邮件已发送。请查看收件箱并按链接操作。',
        );
    } catch {
      setError('网络错误，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="composer auth-form" onSubmit={submit}>
      {mode === 'register' && (
        <label>
          显示名称
          <input name="name" autoComplete="nickname" required maxLength={80} />
        </label>
      )}
      {mode !== 'reset' && (
        <label>
          邮箱
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      )}
      {['register', 'login', 'reset'].includes(mode) && (
        <label>
          {mode === 'reset' ? '新密码' : '密码'}
          <input
            name="password"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            minLength={mode === 'login' ? undefined : 12}
            maxLength={128}
          />
        </label>
      )}
      {mode !== 'login' && ['register', 'reset'].includes(mode) && (
        <p className="muted">密码至少 12 位，最多 128 位。</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!message && (
        <button
          className="button"
          disabled={busy || (mode === 'reset' && !token)}
        >
          {busy ? '处理中…' : labels[mode]}
        </button>
      )}
    </form>
  );
}
