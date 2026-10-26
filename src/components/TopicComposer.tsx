import { useState, type SubmitEvent } from 'react';
type NodeOption = { id: string; name: string };
export default function TopicComposer({ nodes }: { nodes: NodeOption[] }) {
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
      const response = await fetch('/api/v1/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          body: form.get('body'),
          nodeId: form.get('nodeId'),
          requestId: id,
        }),
      });
      const result = (await response.json()) as
        { data: { id: string } } | { error: { message: string } };
      if ('error' in result) {
        setError(result.error.message);
        return;
      }
      window.location.assign(`/t/${result.data.id}`);
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
      <label>
        主题标题
        <input
          name="title"
          required
          minLength={3}
          maxLength={120}
          placeholder="一个清晰的问题，是好讨论的开始"
        />
      </label>
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
      <label>
        正文
        <textarea
          name="body"
          required
          maxLength={20000}
          rows={12}
          placeholder="写下背景、尝试过的方法，以及你的想法。当前阶段以纯文本安全展示。"
        />
      </label>
      <p className="muted">
        以当前已登录账户发布。本阶段仅开放本机写入，暂不支持 Markdown。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy || nodes.length === 0}>
        {busy ? '发布中…' : '发布主题 →'}
      </button>
    </form>
  );
}
