import { useEffect, useState, type SubmitEvent } from 'react';
import ImageUpload from './ImageUpload';
type Profile = {
  username: string;
  displayName: string;
  bio: string;
  avatarId: string | null;
  revision: number;
};
type Upload = { id: string; kind: string; bytes: number };
export default function ProfileEditor({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [files, setFiles] = useState<Upload[]>([]);
  async function loadFiles() {
    const response = await fetch('/api/v1/me/uploads');
    const result = (await response.json()) as
      { data: Upload[] } | { error: unknown };
    if ('data' in result) setFiles(result.data);
  }
  useEffect(() => {
    void loadFiles().catch(() => setMessage('图片列表加载失败，请刷新。'));
  }, []);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profile.displayName,
          bio: profile.bio,
          avatarId: profile.avatarId,
          revision: profile.revision,
        }),
      });
      const result = (await response.json()) as
        { data: unknown } | { error: { message: string } };
      if ('error' in result) setMessage(result.error.message);
      else {
        setProfile((current) => ({
          ...current,
          revision: profile.revision + 1,
        }));
        setMessage('资料已保存。');
      }
    } catch {
      setMessage('保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm('删除后，使用这张图片的正文将无法显示图片。确定删除？'))
      return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/uploads/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = (await response.json()) as
        { data: unknown } | { error: { message: string } };
      if ('error' in result) setMessage(result.error.message);
      else {
        window.location.reload();
      }
    } catch {
      setMessage('删除失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="composer" onSubmit={save}>
        <fieldset disabled={busy}>
          <h2>公开资料</h2>
          <p>
            <a href={`/member/${profile.username}`}>我的主页 →</a>
          </p>
          <p className="muted">用户名：{profile.username}（固定链接标识）</p>
          <label>
            显示名称
            <input
              required
              maxLength={80}
              value={profile.displayName}
              onChange={(e) =>
                setProfile({ ...profile, displayName: e.target.value })
              }
            />
          </label>
          <label>
            个人简介
            <textarea
              maxLength={500}
              rows={3}
              value={profile.bio}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            />
          </label>
          {profile.avatarId && (
            <>
              <img
                className="profile-avatar"
                src={`/api/v1/media/${profile.avatarId}`}
                alt="当前头像"
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setProfile({ ...profile, avatarId: null })}
              >
                移除头像
              </button>
            </>
          )}
          <ImageUpload
            kind="avatar"
            onUploaded={(image) => {
              setProfile((current) => ({ ...current, avatarId: image.id }));
              void loadFiles().catch(() =>
                setMessage('图片列表加载失败，请刷新。'),
              );
            }}
          />
          <button className="button">{busy ? '保存中…' : '保存资料'}</button>
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      <details className="uploads-list">
        <summary>管理我的图片（最近 50 张）</summary>
        <p className="muted">
          每账户总额度 20 MiB。删除图片会影响已有正文中的引用。
        </p>
        {files.map((file) => (
          <div key={file.id} className="upload-row">
            <a
              href={`/api/v1/media/${file.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {file.kind === 'avatar' ? '头像' : '正文图片'} ·{' '}
              {(file.bytes / 1024).toFixed(1)} KiB
            </a>
            <button
              type="button"
              disabled={busy}
              className="text-button"
              onClick={() => void remove(file.id)}
            >
              删除图片
            </button>
          </div>
        ))}
      </details>
    </>
  );
}
