import { useState, type SubmitEvent } from 'react';
import Challenge from './Challenge';
import MarkdownEditor from './MarkdownEditor';
type EditableReply = {
  id: string;
  body: string;
  revision: number;
  floor: number;
};
export default function ReplyComposer({
  topicId,
  reply,
  quote = '',
}: {
  topicId: string;
  reply?: EditableReply;
  quote?: string;
}) {
  const [challengeToken, setToken] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch(
        reply
          ? `/api/v1/replies/${reply.id}`
          : `/api/v1/topics/${topicId}/replies`,
        {
          method: reply ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-turnstile-token': challengeToken,
          },
          body: JSON.stringify({
            body: form.get('body'),
            ...(reply ? { revision: reply.revision } : { requestId: id }),
          }),
        },
      );
      const result = (await response.json()) as
        | { data: { id: string; floor: number } }
        | { error: { message: string } };
      if ('error' in result) {
        setError(result.error.message);
        return;
      }
      const saved = reply ?? result.data;
      window.location.assign(
        `/t/${topicId}?after=${Math.floor((saved.floor - 1) / 30) * 30}#reply-${saved.id}`,
      );
    } catch {
      setError('网络错误，请重试；相同提交不会重复占用楼层。');
    } finally {
      setBusy(false);
      setToken('');
      setChallengeVersion((value) => value + 1);
    }
  }
  return (
    <form
      className="composer"
      onSubmit={submit}
      onChange={() => setRequestId('')}
    >
      <fieldset disabled={busy}>
        <MarkdownEditor label="回复内容" defaultValue={reply?.body ?? quote} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!reply && (
          <Challenge
            action="reply"
            version={challengeVersion}
            onToken={setToken}
          />
        )}
        <button
          className="button"
          disabled={busy || (!reply && !challengeToken)}
        >
          {busy ? '保存中…' : reply ? '保存回复' : '发布回复'}
        </button>
      </fieldset>
    </form>
  );
}
