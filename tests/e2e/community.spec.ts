import { test, expect } from '@playwright/test';
import { registerAndLogin } from './auth-helpers';
test('mentions and replies create private read-state notifications; search and sorts work in the UI', async ({
  page,
  context,
  browser,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.19.1.${Math.floor(Math.random() * 200) + 1}`,
  });
  const recipient = await browser.newContext({
    baseURL: 'http://127.0.0.1:4321',
    extraHTTPHeaders: {
      'cf-connecting-ip': `198.19.2.${Math.floor(Math.random() * 200) + 1}`,
    },
  });
  try {
    const other = await recipient.newPage();
    await registerAndLogin(other);
    const target = (
      await (await other.request.get('/api/v1/me/profile')).json()
    ).data;
    await registerAndLogin(page);
    const actor = (await (await page.request.get('/api/v1/me/profile')).json())
      .data;
    const keyword = `社区验收${crypto.randomUUID().slice(0, 8)}`,
      first = `${keyword} 第一篇`,
      second = `${keyword} 第二篇`;
    await page.goto('/new');
    await page.getByLabel('主题标题').fill(first);
    await page.getByLabel('发布节点').selectOption('dev');
    await page
      .getByLabel('正文', { exact: true })
      .fill(
        `请 @${target.username} 看看这个问题。\n\n> @unknown\n\n\`@unknown\``,
      );
    await page.getByRole('button', { name: '发布主题' }).click();
    await expect(page).toHaveURL(/\/t\/[a-f\d-]+$/);
    const topicURL = page.url();
    await expect(
      page
        .locator('.topic-body')
        .getByRole('link', { name: `@${target.username}`, exact: true }),
    ).toHaveAttribute('href', `/member/${target.username}`);
    await page.goto('/new');
    await page.getByLabel('主题标题').fill(second);
    await page.getByLabel('发布节点').selectOption('dev');
    await page.getByLabel('正文', { exact: true }).fill('用于验证最新排序');
    await page.getByRole('button', { name: '发布主题' }).click();
    await expect(page).toHaveURL(/\/t\/[a-f\d-]+$/);
    await other.goto('/notifications');
    await expect(
      other.getByRole('link', { name: '通知 (1)', exact: true }),
    ).toBeVisible();
    await expect(other.locator('.notification-row')).toHaveCount(1);
    await expect(other.locator('.notification-row')).toContainText('提到了你');
    await other.getByRole('button', { name: '标记已读', exact: true }).click();
    await expect(other.locator('.unread-badge')).toHaveCount(0);
    await expect(
      other.getByRole('link', { name: '通知', exact: true }),
    ).toBeVisible();
    await other.getByRole('link', { name: first, exact: true }).click();
    await other.getByRole('button', { name: /^点赞 / }).click();
    await other
      .getByLabel('回复内容', { exact: true })
      .fill('这是给主题作者的回复');
    await other.getByRole('button', { name: '发布回复', exact: true }).click();
    await expect(other).toHaveURL(/#reply-/);
    await page.goto('/notifications');
    await expect(page.locator('.notification-row')).toHaveCount(1);
    await expect(page.locator('.notification-row')).toContainText(
      '回复了你的主题',
    );
    await page.getByRole('link', { name: first, exact: true }).click();
    await expect(page).toHaveURL(/#reply-/);
    await page.goto('/');
    const form = page.getByRole('search');
    await form.getByLabel('搜索讨论').fill(keyword);
    for (const [sort, title] of [
      ['latest', second],
      ['hot', first],
      ['active', first],
    ] as const) {
      await form.getByLabel('排序', { exact: true }).selectOption(sort);
      await form.getByRole('button', { name: '查看', exact: true }).click();
      await expect(page.locator('.topic-title').first()).toHaveText(title);
      await expect(form.getByLabel('搜索讨论')).toHaveValue(keyword);
    }
    await page.goto(
      `/go/dev?${new URLSearchParams({ q: keyword, sort: 'hot' })}`,
    );
    await expect(page.locator('.topic-title').first()).toHaveText(first);
    await page.goto(
      `/member/${actor.username}?${new URLSearchParams({ q: keyword, sort: 'active' })}`,
    );
    await expect(page.locator('.topic-title')).toHaveCount(2);
    await expect(page.locator('.topic-title').first()).toHaveText(first);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto(
      '/?q=' + encodeURIComponent('<script>window.searchXss=true</script>'),
    );
    expect(await page.evaluate(() => Object.hasOwn(window, 'searchXss'))).toBe(
      false,
    );
    expect((await page.request.get('/api/v1/topics?sort=wrong')).status()).toBe(
      400,
    );
    await other.goto(topicURL);
    await expect(other.locator('.topic-body')).toContainText('看看这个问题');
  } finally {
    await recipient.close();
  }
});
