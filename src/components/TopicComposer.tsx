import { useState, type SubmitEvent } from 'react';
import MarkdownEditor from './MarkdownEditor';
type NodeOption = { id: string; name: string };
type EditableTopic = {
  id: string;
  title: string;
  body: string;
  revision: number;
};
export default function TopicComposer({
  nodes,
  topic,
}: {
  nodes: NodeOption[];
  topic?: EditableTopic;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch(
        topic ? `/api/v1/topics/${topic.id}` : '/api/v1/topics',
        {
          method: topic ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.get('title'),
            body: form.get('body'),
            ...(topic
              ? { revision: topic.revision }
              : { nodeId: form.get('nodeId'), requestId: id }),
          }),
        },
      );
      const result = (await response.json()) as
        { data: { id: string } } | { error: { message: string } };
      if ('error' in result) {
        setError(result.error.message);
        return;
      }
      window.location.assign(`/t/${topic?.id ?? result.data.id}`);
    } catch {
      setError('网络错误，请重试；重复提交不会创建重复主题。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="composer"
      onChange={() => setRequestId('')}
    >
      <fieldset disabled={busy}>
        <label>
          主题标题
          <input
            name="title"
            required
            minLength={3}
            maxLength={120}
            defaultValue={topic?.title}
            placeholder="一个清晰的问题，是好讨论的开始"
          />
        </label>
        {!topic && (
          <label>
            发布节点
            <select name="nodeId" required>
              {nodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <MarkdownEditor defaultValue={topic?.body} />
        <p className="muted">以当前已登录账户发布。本阶段仅开放本机写入。</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          className="button"
          disabled={busy || (!topic && nodes.length === 0)}
        >
          {busy ? '保存中…' : topic ? '保存主题' : '发布主题 →'}
        </button>
      </fieldset>
    </form>
  );
}
