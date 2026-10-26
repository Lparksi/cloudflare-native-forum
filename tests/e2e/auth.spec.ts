import { test, expect } from '@playwright/test';
import { registerAndLogin, latestMail, initialPassword } from './auth-helpers';

test('verification, session, sign-out and password reset work through the UI', async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
  });
  const email = await registerAndLogin(page);
  await page.reload();
  await expect(page.locator('.account-details')).toContainText('已验证');
  const oldCookies = await context.cookies();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/forgot-password');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByRole('button', { name: '发送重置邮件' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const resetURL = await latestMail(page, email, 'reset');
  await page.goto(resetURL);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  const newPassword = 'Changed browser test password 2026!';
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '设置新密码' }).click();
  await expect(page.getByRole('status')).toContainText('密码已更新');
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确');
  await page.getByLabel('密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(
    oldCookies.some(
      (cookie) => cookie.httpOnly && cookie.name.includes('session_token'),
    ),
  ).toBe(true);
  await page.goto(resetURL);
  await expect(page).toHaveURL(/error=INVALID_TOKEN/);
});
