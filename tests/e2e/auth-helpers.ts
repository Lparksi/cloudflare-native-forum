import { expect, type Page } from '@playwright/test';
export const initialPassword = 'Browser test password 42!';
export async function latestMail(page: Page, email: string, kind: string) {
  const response = await page.request.get(
    `/api/v1/dev/mail?email=${encodeURIComponent(email)}`,
  );
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as {
    data: { kind: string; url: string }[];
  };
  return data.find((message) => message.kind === kind)!.url;
}
export async function registerAndLogin(page: Page) {
  const email = `${crypto.randomUUID()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('显示名称').fill('浏览器测试成员');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.getByRole('status')).toContainText('如果该邮箱符合条件');
  await page.goto(await latestMail(page, email, 'verification'));
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('.account-details')).toContainText(email);
  return email;
}
