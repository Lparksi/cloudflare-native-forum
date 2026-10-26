import { useEffect, useRef, useState } from 'react';
import type { ChallengeAction } from '../security/turnstile';
type Widget = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
let script: Promise<void> | undefined;
function loadScript() {
  return (script ??= new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const element = document.createElement('script');
    element.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('Challenge script unavailable'));
    document.head.appendChild(element);
  }));
}
export default function Challenge({
  action,
  version,
  onToken,
}: {
  action: ChallengeAction;
  version: number;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    refresh = useRef<() => void>(() => {});
  const [message, setMessage] = useState('正在加载验证…');
  useEffect(() => {
    let alive = true;
    let widget: string | undefined;
    onToken('');
    async function localToken() {
      onToken('');
      try {
        const response = await fetch('/api/v1/security/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const result = (await response.json()) as
          { data: { token: string } } | { error: unknown };
        if ('error' in result) throw new Error('Challenge unavailable');
        if (alive) {
          onToken(result.data.token);
          setMessage('本地模拟验证已就绪');
        }
      } catch {
        if (alive) {
          onToken('');
          setMessage('验证不可用，请稍后刷新重试');
        }
      }
    }
    async function setup() {
      try {
        const response = await fetch('/api/v1/security/config');
        const { data: config } = (await response.json()) as {
          data: { mode: string; siteKey: string };
        };
        if (!alive) return;
        if (config.mode === 'local') {
          refresh.current = () => void localToken();
          await localToken();
          return;
        }
        if (config.mode !== 'managed' || !config.siteKey)
          throw new Error('Verification not configured');
        await loadScript();
        if (!alive || !container.current || !window.turnstile) return;
        const expire = () => {
          if (alive) {
            onToken('');
            setMessage('验证已失效，请重新验证');
          }
        };
        widget = window.turnstile.render(container.current, {
          sitekey: config.siteKey,
          action,
          callback: (token) => {
            if (alive) {
              onToken(token);
              setMessage('验证完成');
            }
          },
          'expired-callback': expire,
          'timeout-callback': expire,
          'error-callback': expire,
        });
        refresh.current = () => {
          onToken('');
          if (widget) window.turnstile?.reset(widget);
        };
        setMessage('请完成验证');
      } catch {
        if (alive) {
          onToken('');
          setMessage('验证不可用，请稍后刷新重试');
        }
      }
    }
    void setup();
    return () => {
      alive = false;
      refresh.current = () => {};
      if (widget) window.turnstile?.remove(widget);
      onToken('');
    };
  }, [action, onToken]);
  useEffect(() => {
    if (version > 0) refresh.current();
  }, [version]);
  return (
    <div className="challenge">
      <div ref={container} />
      <p className="muted" role="status">
        {message}
      </p>
    </div>
  );
}
