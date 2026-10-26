import { test, expect } from '@playwright/test';
import { registerAndLogin } from './auth-helpers';
import { resolveBuildInfo } from '../../scripts/build-info.mjs';

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
  });
});

test('create, persist, render safely and browse a topic', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['server-timing']).toMatch(/app;dur=\d+(\.\d+)?/);
  const metadata = resolveBuildInfo();
  await expect(page.locator('footer')).toContainText(`v${metadata.version}`);
  await expect(
    page.locator('footer [title="' + metadata.commitSha + '"]'),
  ).toHaveText(metadata.shortCommitSha);
  const serverTiming = response!.headers()['server-timing'];
  const duration = serverTiming.match(/app;dur=([\d.]+)/)![1];
  await expect(page.locator('[data-server-timing]')).toHaveText(
    `Server ${duration}ms`,
  );
  await page.getByRole('link', { name: '＋ 发起讨论' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await registerAndLogin(page);
  await page.goto('/new');
  const title = `端到端讨论 ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('主题标题').fill(title);
  await page
    .getByLabel('正文', { exact: true })
    .fill('**一条真实保存的讨论**\n\n<script>window.xss = true</script>');
  await page.getByRole('button', { name: '发布主题' }).click();
  await expect(page).toHaveURL(/\/t\/[a-f0-9-]+/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.topic-body strong')).toHaveText(
    '一条真实保存的讨论',
  );
  await expect(page.locator('.topic-body script')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, 'xss'))).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('link', { name: '返回讨论' }).click();
  await expect(
    page.getByRole('link', { name: title, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: /^外观：/ }).click();
  await page.getByRole('menuitemradio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /^外观：/ }).click();
  await page.getByRole('menuitemradio', { name: '浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('node pages and missing pages have a working layout', async ({ page }) => {
  await page.goto('/nodes');
  await page.getByRole('link', { name: /开发技术/ }).click();
  await expect(
    page.getByRole('heading', { name: '开发技术', exact: true }),
  ).toBeVisible();
  const missing = await page.goto('/t/not-found');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '主题不存在' })).toBeVisible();
});
