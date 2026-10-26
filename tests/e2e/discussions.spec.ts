import { test, expect } from '@playwright/test';
import { registerAndLogin } from './auth-helpers';

test('Markdown preview, edits, quotes, replies, tombstones, votes and bookmarks persist', async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
  });
  await registerAndLogin(page);
  await page.goto('/new');
  const title = `完整讨论闭环 ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('主题标题').fill(title);
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '## 安全标题\n\n**重点内容**\n\n```js\nconst value = 42;\n```\n\n<script>window.phase3xss = true</script>\n\n[危险链接](javascript:alert%281%29)',
    );
  await page.getByRole('button', { name: '预览 Markdown' }).click();
  await expect(
    page.getByLabel('Markdown 预览').getByRole('heading', { name: '安全标题' }),
  ).toBeVisible();
  await expect(page.getByLabel('Markdown 预览').locator('script')).toHaveCount(
    0,
  );
  const preview = await page.getByLabel('Markdown 预览').innerHTML();
  await page.getByRole('button', { name: '发布主题' }).click();
  await expect(page).toHaveURL(/\/t\/[a-f\d-]+$/);
  const topicURL = page.url();
  expect(await page.locator('.topic-body').innerHTML()).toBe(preview);
  await expect(page.locator('.topic-body .hljs-keyword')).toContainText(
    'const',
  );
  expect(await page.evaluate(() => Object.hasOwn(window, 'phase3xss'))).toBe(
    false,
  );
  await page.getByRole('button', { name: '点赞 0', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '取消点赞 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收藏主题', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: '取消收藏', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '我的收藏', exact: true }).click();
  await expect(
    page.getByRole('link', { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('link', { name: '编辑主题', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('**主题已编辑**');
  await page.getByRole('button', { name: '保存主题' }).click();
  await expect(page.locator('.topic-body strong')).toHaveText('主题已编辑');
  await page.getByLabel('回复内容').fill('**第一条回复**');
  await page.getByRole('button', { name: '发布回复' }).click();
  await expect(
    page.getByRole('heading', { name: '1 条回复', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.reply-body strong')).toHaveText('第一条回复');
  await page.getByRole('link', { name: '引用 #1', exact: true }).click();
  await expect(page.getByLabel('回复内容')).toHaveValue(/> \[#1\]/);
  await page
    .getByLabel('回复内容')
    .fill(
      (await page.getByLabel('回复内容').inputValue()) + '\n我同意这个观点。',
    );
  await page.getByRole('button', { name: '发布回复' }).click();
  await expect(
    page.getByRole('heading', { name: '2 条回复', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.reply-body blockquote')).toContainText(
    '第一条回复',
  );
  const first = page.locator('.reply-row').first();
  await first.getByRole('link', { name: '编辑回复', exact: true }).click();
  await page.getByLabel('回复内容').fill('**第一条回复已编辑**');
  await page.getByRole('button', { name: '保存回复' }).click();
  await expect(
    page.locator('.reply-row').first().locator('strong').last(),
  ).toHaveText('第一条回复已编辑');
  await page
    .locator('.reply-row')
    .first()
    .getByRole('button', { name: '删除回复', exact: true })
    .click();
  await page.getByRole('button', { name: '确认删除回复', exact: true }).click();
  await expect(page.locator('.reply-row').first()).toContainText(
    '此回复已移除',
  );
  await expect(page.locator('.reply-row').first()).not.toContainText(
    '第一条回复已编辑',
  );
  await expect(
    page.getByRole('heading', { name: '1 条回复', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消点赞 1', exact: true }).click();
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '删除主题', exact: true }).click();
  await page.getByRole('button', { name: '确认删除主题', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.goto(topicURL))?.status()).toBe(404);
});
