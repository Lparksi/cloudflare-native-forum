import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { registerAndLogin, initialPassword } from './auth-helpers';
function localSql(command: string) {
  if (!process.env.FORUM_STATE_PATH)
    throw new Error('Missing isolated E2E database');
  return JSON.parse(
    execFileSync(
      'pnpm',
      [
        'exec',
        'wrangler',
        'd1',
        'execute',
        'DB',
        '--local',
        '--persist-to',
        process.env.FORUM_STATE_PATH,
        '--command',
        command,
        '--json',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, WRANGLER_LOG_PATH: '.wrangler/logs' },
      },
    ),
  );
}
test('admin grants moderator; moderator resolves reports, moderates content and bans members', async ({
  page,
  context,
  browser,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 180) + 1}`,
  });
  const adminEmail = await registerAndLogin(page);
  const adminSession = await (
    await page.request.get('/api/auth/get-session')
  ).json();
  const admins = localSql(
    "SELECT count(*) AS n FROM account_access WHERE role='admin' AND banned=0",
  );
  if (admins[0].results[0].n === 0)
    execFileSync('pnpm', ['admin:bootstrap', adminEmail], {
      encoding: 'utf8',
      env: process.env,
    });
  else
    localSql(
      `UPDATE account_access SET role='admin',revision=revision+1 WHERE user_id='${adminSession.user.id}'`,
    );
  const modContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:4321',
      extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.222' },
    }),
    targetContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:4321',
      extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.223' },
    });
  try {
    const modPage = await modContext.newPage();
    await registerAndLogin(modPage);
    const modSession = await (
      await modPage.request.get('/api/auth/get-session')
    ).json();
    const targetPage = await targetContext.newPage();
    const targetEmail = await registerAndLogin(targetPage);
    const targetSession = await (
      await targetPage.request.get('/api/auth/get-session')
    ).json();
    await page.goto('/admin');
    await page.getByRole('button', { name: '用户管理', exact: true }).click();
    const modRow = page.getByTestId(`admin-${modSession.user.id}`);
    await modRow.getByLabel('角色').selectOption('moderator');
    await modRow.getByLabel('操作原因').fill('授予测试版主权限');
    await modRow.getByRole('button', { name: '保存角色' }).click();
    await expect(modRow).toContainText('moderator');
    await modPage.goto('/settings');
    await expect(modPage.getByRole('link', { name: '管理后台' })).toBeVisible();
    await targetPage.goto('/new');
    await targetPage.getByLabel('主题标题').fill('待审核的端到端主题');
    await targetPage
      .getByLabel('正文', { exact: true })
      .fill('需要审核的测试内容');
    await targetPage.getByRole('button', { name: '发布主题' }).click();
    await expect(targetPage).toHaveURL(/\/t\/[a-f\d-]+$/);
    const topicURL = targetPage.url(),
      topicId = topicURL.split('/').at(-1)!;
    await modPage.goto(topicURL);
    await modPage
      .getByRole('button', { name: '举报主题', exact: true })
      .click();
    await modPage.getByLabel('举报原因').fill('疑似违规内容需要审核');
    await modPage.getByRole('button', { name: '提交举报' }).click();
    await expect(
      modPage.getByText('举报已提交，等待审核。', { exact: true }),
    ).toBeVisible();
    await modPage.goto('/admin');
    const reports = await (
      await modPage.request.get('/api/v1/admin/reports')
    ).json();
    const report = reports.data.items.find(
      (row: { topic_id: string }) => row.topic_id === topicId,
    );
    const reportRow = modPage.getByTestId(`admin-${report.id}`);
    await expect(reportRow).toContainText(topicId);
    await reportRow.getByLabel('操作原因').fill('已核查并完成处理');
    await reportRow.getByRole('button', { name: '标记已处理' }).click();
    await expect(reportRow).toContainText('resolved');
    await modPage
      .getByRole('button', { name: '主题审核', exact: true })
      .click();
    const topicRow = modPage.getByTestId(`admin-${topicId}`);
    await topicRow.getByLabel('操作原因').fill('隐藏违规测试内容');
    await topicRow.getByRole('button', { name: '隐藏内容' }).click();
    await expect(topicRow).toContainText('hidden');
    expect((await targetPage.goto(topicURL))?.status()).toBe(404);
    await topicRow.getByLabel('操作原因').fill('复核后恢复测试内容');
    await topicRow.getByRole('button', { name: '恢复内容' }).click();
    await expect(topicRow).toContainText('published');
    expect((await targetPage.goto(topicURL))?.status()).toBe(200);
    await modPage
      .getByRole('button', { name: '用户管理', exact: true })
      .click();
    const targetRow = modPage.getByTestId(`admin-${targetSession.user.id}`);
    await targetRow.getByLabel('操作原因').fill('封禁垃圾内容测试账户');
    await targetRow.getByRole('button', { name: '封禁用户' }).click();
    await expect(targetRow).toContainText('已封禁');
    expect(
      await (await targetPage.request.get('/api/auth/get-session')).json(),
    ).toBeNull();
    await targetPage.goto('/settings');
    await expect(targetPage).toHaveURL(/\/login$/);
    await targetRow.getByLabel('操作原因').fill('核查后解除测试封禁');
    await targetRow.getByRole('button', { name: '解除封禁' }).click();
    await expect(targetRow).toContainText('正常');
    await targetPage.getByLabel('邮箱', { exact: true }).fill(targetEmail);
    await targetPage.getByLabel('密码', { exact: true }).fill(initialPassword);
    await targetPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(targetPage).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: '节点管理', exact: true }).click();
    await page.locator('summary').filter({ hasText: '创建节点' }).click();
    const form = page.locator('details form');
    await form
      .getByLabel('Slug')
      .fill(`e2e-${crypto.randomUUID().slice(0, 8)}`);
    await form.getByLabel('节点名称').fill('测试管理节点');
    await form.getByLabel('介绍').fill('端到端节点说明');
    await form.getByLabel('操作原因').fill('创建端到端测试节点');
    await form.getByRole('button', { name: '创建节点', exact: true }).click();
    await expect(
      page.getByText('操作完成，已记录审核日志。', { exact: true }),
    ).toBeVisible();
    await modPage
      .getByRole('button', { name: '节点管理', exact: true })
      .click();
    await expect(
      modPage.locator('summary').filter({ hasText: '创建节点' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '审核日志', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'ban', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'set-role', exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await modContext.close();
    await targetContext.close();
  }
});
