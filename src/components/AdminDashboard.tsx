import { useEffect, useState, type SubmitEvent } from 'react';
import type { Role } from '../security/access';
type Section = 'users' | 'topics' | 'replies' | 'nodes' | 'reports' | 'logs';
type Row = {
  id: string;
  name?: string;
  role?: Role;
  banned?: number;
  banReason?: string;
  revision: number;
  title?: string;
  body?: string;
  status?: string;
  reason?: string;
  action?: string;
  target_id?: string;
  actor_id?: string;
  slug?: string;
  description?: string;
  sort_order?: number;
  hidden?: number;
  topic_id?: string;
  reply_id?: string;
};
const names: Record<Section, string> = {
  users: '用户管理',
  topics: '主题审核',
  replies: '回复审核',
  nodes: '节点管理',
  reports: '举报处理',
  logs: '审核日志',
};
export default function AdminDashboard({
  role,
  actorId,
}: {
  role: Role;
  actorId: string;
}) {
  const [section, setSection] = useState<Section>('reports'),
    [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function load(kind: Section, after = '') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/v1/admin/${kind}?after=${encodeURIComponent(after)}`,
      );
      const result = (await response.json()) as
        | { data: { items: Row[]; nextCursor: string | null } }
        | { error: { message: string } };
      if ('error' in result) {
        setRows([]);
        setNext(null);
        setMessage(result.error.message);
      } else {
        setRows(result.data.items);
        setNext(result.data.nextCursor);
      }
    } catch {
      setRows([]);
      setMessage('加载失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load(section);
  }, [section]);
  async function submit(event: SubmitEvent<HTMLFormElement>, row?: Row) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const action = (event.nativeEvent.submitter as HTMLButtonElement).value;
    const reason = String(data.get('reason'));
    let path = '',
      method = 'PATCH',
      body: Record<string, unknown> = { reason, revision: row?.revision };
    if (section === 'users') {
      path = `/users/${row!.id}/${action === 'role' ? 'role' : 'ban'}`;
      body =
        action === 'role'
          ? { ...body, role: data.get('role') }
          : { ...body, banned: !row!.banned };
    } else if (section === 'topics' || section === 'replies') {
      path = `/${section}/${row!.id}/visibility`;
      body = { ...body, hidden: row!.status === 'published' };
    } else if (section === 'reports') {
      path = `/reports/${row!.id}`;
      body = { ...body, status: action };
    } else if (section === 'nodes') {
      path = `/nodes${row ? `/${row.id}` : ''}`;
      method = row ? 'PATCH' : 'POST';
      body = {
        slug: data.get('slug'),
        name: data.get('name'),
        description: data.get('description'),
        sortOrder: Number(data.get('sortOrder')),
        hidden: data.get('hidden') === 'on',
        reason,
      };
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/admin${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as
        { data: unknown } | { error: { message: string } };
      if ('error' in result) setMessage(result.error.message);
      else {
        await load(section);
        setMessage('操作完成，已记录审核日志。');
      }
    } catch {
      setMessage('操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function nodeFields(row?: Row) {
    return (
      <>
        <label>
          Slug
          <input
            name="slug"
            defaultValue={row?.slug}
            required
            pattern="[a-z0-9][a-z0-9-]{0,63}"
          />
        </label>
        <label>
          节点名称
          <input name="name" defaultValue={row?.name} required maxLength={80} />
        </label>
        <label>
          介绍
          <textarea
            name="description"
            defaultValue={row?.description}
            maxLength={1000}
          />
        </label>
        <label>
          排序
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={row?.sort_order ?? 0}
            required
          />
        </label>
        <label>
          <input name="hidden" type="checkbox" defaultChecked={!!row?.hidden} />{' '}
          隐藏节点
        </label>
      </>
    );
  }
  return (
    <div className="admin-dashboard">
      <nav className="admin-tabs" aria-label="管理分类">
        {(Object.keys(names) as Section[]).map((key) => (
          <button
            key={key}
            className="text-button"
            aria-current={section === key ? 'page' : undefined}
            disabled={busy}
            onClick={() => setSection(key)}
          >
            {names[key]}
          </button>
        ))}
      </nav>
      <p className="muted">
        当前权限：{role === 'admin' ? '管理员' : '版主'}
        。每项操作都需要填写原因；无法修改自己的权限或封禁自己。
      </p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {section === 'nodes' && role === 'admin' && (
        <details className="panel padded">
          <summary>创建节点</summary>
          <form
            className="composer admin-form"
            onSubmit={(e) => void submit(e)}
          >
            <fieldset disabled={busy}>
              {nodeFields()}
              <label>
                操作原因
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="button" value="create">
                创建节点
              </button>
            </fieldset>
          </form>
        </details>
      )}
      {rows.map((row) => (
        <article
          className="panel padded admin-row"
          key={row.id}
          data-testid={`admin-${row.id}`}
        >
          <h2>{row.name ?? row.title ?? row.action ?? row.reason ?? row.id}</h2>
          <p className="muted">
            ID: {row.id}{' '}
            {row.role && `· ${row.role} · ${row.banned ? '已封禁' : '正常'}`}{' '}
            {row.status && `· ${row.status}`}
          </p>
          {row.body && (
            <details>
              <summary>查看原文</summary>
              <pre className="admin-raw">{row.body}</pre>
            </details>
          )}
          {row.reason && <p>{row.reason}</p>}
          {section === 'reports' && (
            <p className="muted">
              举报目标：{row.topic_id ? '主题' : '回复'}{' '}
              {row.topic_id ?? row.reply_id}
              {row.topic_id && (
                <>
                  {' '}
                  · <a href={`/t/${row.topic_id}`}>查看主题</a>
                </>
              )}
            </p>
          )}
          {row.banReason && <p>封禁原因：{row.banReason}</p>}
          {section === 'logs' ? (
            <p>
              操作者：{row.actor_id} · 目标：{row.target_id}
            </p>
          ) : (
            <form
              className="composer admin-form"
              onSubmit={(e) => void submit(e, row)}
            >
              <fieldset disabled={busy}>
                {section === 'nodes' && role === 'admin' && nodeFields(row)}
                {section === 'users' &&
                  role === 'admin' &&
                  row.id !== actorId &&
                  !row.banned && (
                    <label>
                      角色
                      <select name="role" defaultValue={row.role}>
                        <option value="member">普通会员</option>
                        <option value="moderator">版主</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                  )}
                {((section === 'users' &&
                  row.id !== actorId &&
                  (role === 'admin' || row.role === 'member')) ||
                  ((section === 'topics' || section === 'replies') &&
                    row.status !== 'deleted') ||
                  (section === 'reports' && row.status === 'open') ||
                  (section === 'nodes' && role === 'admin')) && (
                  <label>
                    操作原因
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                    />
                  </label>
                )}
                {section === 'users' && row.id !== actorId && (
                  <>
                    {role === 'admin' && !row.banned && (
                      <button className="button" value="role">
                        保存角色
                      </button>
                    )}
                    {row.role !== 'admin' &&
                      (role === 'admin' || row.role === 'member') && (
                        <button className="button" value="ban">
                          {row.banned ? '解除封禁' : '封禁用户'}
                        </button>
                      )}
                  </>
                )}
                {(section === 'topics' || section === 'replies') &&
                  row.status !== 'deleted' && (
                    <button className="button" value="visibility">
                      {row.status === 'published' ? '隐藏内容' : '恢复内容'}
                    </button>
                  )}
                {section === 'reports' && row.status === 'open' && (
                  <>
                    <button className="button" value="resolved">
                      标记已处理
                    </button>
                    <button className="button" value="dismissed">
                      驳回举报
                    </button>
                  </>
                )}
                {section === 'nodes' && role === 'admin' && (
                  <button className="button" value="save">
                    保存节点
                  </button>
                )}
              </fieldset>
            </form>
          )}
        </article>
      ))}
      {!rows.length && !busy && <p className="padded muted">暂无记录。</p>}
      <div className="admin-pagination">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void load(section)}
        >
          返回首屏 / 刷新
        </button>
        {next && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load(section, next)}
          >
            下一页 →
          </button>
        )}
      </div>
    </div>
  );
}
