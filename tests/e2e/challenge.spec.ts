import { test, expect } from '@playwright/test';
test('managed widget clears expired proofs, resets after requests and removes on unmount', async ({
  page,
}) => {
  await page.route('**/api/v1/security/config', (route) =>
    route.fulfill({
      json: { data: { mode: 'managed', siteKey: 'public-test-sitekey' } },
    }),
  );
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.__resetCount=0;window.__removeCount=0;window.turnstile={render:(element,options)=>{window.__complete=()=>options.callback('mock-'+crypto.randomUUID());window.__expire=options['expired-callback'];window.__complete();return 'widget-1';},reset:()=>{window.__resetCount++;window.__complete();},remove:()=>{window.__removeCount++;}};`,
      }),
  );
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('widget@example.com');
  await page
    .getByLabel('密码', { exact: true })
    .fill('Example widget test password!');
  await expect(
    page.getByRole('button', { name: '登录', exact: true }),
  ).toBeEnabled();
  await page.evaluate('window.__expire()');
  await expect(
    page.getByRole('button', { name: '登录', exact: true }),
  ).toBeDisabled();
  await page.evaluate('window.__complete()');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate('window.__resetCount')).toBe(1);
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({
      json: {
        token: null,
        user: {
          id: 'widget-only',
          name: 'test',
          email: 'widget@example.com',
          emailVerified: false,
        },
      },
    }),
  );
  await page.goto('/register');
  await page.getByLabel('显示名称').fill('组件生命周期测试');
  await page.getByLabel('邮箱', { exact: true }).fill('widget@example.com');
  await page
    .getByLabel('密码', { exact: true })
    .fill('Example widget test password!');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(
    page.getByText(
      '如果该邮箱符合条件，邮件已发送。请查看收件箱并按链接操作。',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.evaluate('window.__removeCount')).toBe(1);
});
