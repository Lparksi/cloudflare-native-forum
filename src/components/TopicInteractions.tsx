import { useState } from 'react';
type State = { voteCount: number; voted: boolean; bookmarked: boolean };
export default function TopicInteractions({
  topicId,
  initial,
}: {
  topicId: string;
  initial: State;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(kind: 'vote' | 'bookmark') {
    setBusy(true);
    setError('');
    const active = kind === 'vote' ? state.voted : state.bookmarked;
    try {
      const response = await fetch(`/api/v1/topics/${topicId}/${kind}`, {
        method: active ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = (await response.json()) as
        { data: State } | { error: { message: string } };
      if ('error' in result) setError(result.error.message);
      else setState(result.data);
    } catch {
      setError('操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="interaction-bar">
      <button
        className="text-button"
        aria-pressed={state.voted}
        disabled={busy}
        onClick={() => void change('vote')}
      >
        {state.voted ? '取消点赞' : '点赞'} {state.voteCount}
      </button>
      <button
        className="text-button"
        aria-pressed={state.bookmarked}
        disabled={busy}
        onClick={() => void change('bookmark')}
      >
        {state.bookmarked ? '取消收藏' : '收藏主题'}
      </button>
      <a href="/bookmarks">我的收藏</a>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
