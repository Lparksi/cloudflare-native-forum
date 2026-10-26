import { and, desc, gt, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { devMail } from '../db/schema';
import { localWriteAllowed } from '../lib/contracts';

export type AuthMail = {
  to: string;
  kind: 'verification' | 'reset';
  url: string;
};
export function localMailboxAllowed(env: Env, url: string) {
  return (
    env.AUTH_MAIL_MODE === 'local' &&
    localWriteAllowed(env.APP_ENV, url) &&
    new URL(url).origin === new URL(env.BETTER_AUTH_URL).origin
  );
}
export async function sendAuthMail(env: Env, mail: AuthMail) {
  if (env.AUTH_MAIL_MODE === 'local') {
    if (!localMailboxAllowed(env, env.BETTER_AUTH_URL))
      throw new Error('Local mail is only available on loopback');
    const db = drizzle(env.DB);
    const now = Date.now();
    await db.delete(devMail).where(lte(devMail.expiresAt, now));
    await db.insert(devMail).values({
      id: crypto.randomUUID(),
      ...mail,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000,
    });
    return;
  }
  if (env.AUTH_MAIL_MODE !== 'cloudflare')
    throw new Error('Mail delivery is disabled');
  const subject =
    mail.kind === 'verification' ? '验证你的 0xca 邮箱' : '重置你的 0xca 密码';
  const text = `${subject}\n\n请打开以下链接：\n${mail.url}\n\n如果不是你发起的操作，请忽略此邮件。`;
  const escaped = mail.url
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  await env.AUTH_EMAIL.send({
    to: mail.to,
    from: { email: env.AUTH_MAIL_FROM, name: '0xca' },
    subject,
    text,
    html: `<p>${subject}</p><p><a href="${escaped}">继续操作</a></p><p>如果不是你发起的操作，请忽略此邮件。</p>`,
  });
}
export async function localMessages(env: Env, email?: string) {
  return drizzle(env.DB)
    .select()
    .from(devMail)
    .where(
      and(
        gt(devMail.expiresAt, Date.now()),
        email ? eq(devMail.to, email) : undefined,
      ),
    )
    .orderBy(desc(devMail.createdAt), desc(devMail.id))
    .limit(20);
}
