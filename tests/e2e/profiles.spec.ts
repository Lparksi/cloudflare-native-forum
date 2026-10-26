import { test, expect } from '@playwright/test';
import { registerAndLogin } from './auth-helpers';
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
test('preserves new profile inputs and avatar across either upload/save response order', async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.18.1.${Math.floor(Math.random() * 200) + 1}`,
  });
  await registerAndLogin(page);
  for (const order of ['upload-first', 'save-first']) {
    await page.goto('/settings');
    await page
      .getByLabel('选择头像', { exact: true })
      .setInputFiles('tests/fixtures/avatar.webp');
    await expect(
      page.getByRole('button', { name: '上传头像', exact: true }),
    ).toBeVisible();
    const uploadReady = gate(),
      saveReady = gate(),
      releaseUpload = gate(),
      releaseSave = gate();
    let avatarURL = '';
    await page.route('**/api/v1/uploads/avatar', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      avatarURL = (await response.json()).data.url;
      uploadReady.resolve();
      await releaseUpload.promise;
      await route.fulfill({ response });
    });
    await page.route('**/api/v1/me/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      saveReady.resolve();
      await releaseSave.promise;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '上传头像', exact: true }).click();
    await uploadReady.promise;
    const name = `上传过程中名称 ${order}`;
    await page.getByLabel('显示名称', { exact: true }).fill(name);
    await page.getByLabel('个人简介').fill('上传期间编辑的简介');
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await saveReady.promise;
    if (order === 'upload-first') {
      releaseUpload.resolve();
      await expect(page.getByAltText('当前头像')).toHaveAttribute(
        'src',
        avatarURL,
      );
      releaseSave.resolve();
    } else {
      releaseSave.resolve();
      await expect(
        page.getByText('资料已保存。', { exact: true }),
      ).toBeVisible();
      releaseUpload.resolve();
    }
    await expect(page.getByAltText('当前头像')).toHaveAttribute(
      'src',
      avatarURL,
    );
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
      name,
    );
    await expect(page.getByLabel('个人简介')).toHaveValue('上传期间编辑的简介');
    await expect(page.getByText('资料已保存。', { exact: true })).toBeVisible();
    await page.unroute('**/api/v1/me/profile');
    await page.unroute('**/api/v1/uploads/avatar');
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/me/profile') &&
        r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByAltText('当前头像')).toHaveAttribute(
      'src',
      avatarURL,
    );
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
      name,
    );
  }
});
test('compresses images to WebP, saves avatar/profile and renders public member pages and uploaded Markdown', async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
  });
  const email = await registerAndLogin(page);
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#296cba';
    ctx.fillRect(100, 100, 1800, 800);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByLabel('显示名称', { exact: true }).fill('资料测试成员');
  await page
    .getByLabel('个人简介')
    .fill('我的简介 <script>window.profileXss=true</script>');
  await page.getByLabel('选择头像', { exact: true }).setInputFiles({
    name: 'personal.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source, 'base64'),
  });
  await expect(page.locator('.image-upload')).toContainText('256×256 · WebP');
  await page.getByRole('button', { name: '上传头像', exact: true }).click();
  await expect(page.getByAltText('当前头像')).toBeVisible();
  const avatarURL = await page.getByAltText('当前头像').getAttribute('src');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('资料已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
    '资料测试成员',
  );
  await page.getByRole('link', { name: '我的主页 →', exact: true }).click();
  const memberURL = page.url();
  await expect(
    page.getByRole('heading', { name: '资料测试成员', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.profile-bio')).toContainText(
    '<script>window.profileXss=true</script>',
  );
  expect(await page.evaluate(() => Object.hasOwn(window, 'profileXss'))).toBe(
    false,
  );
  expect(await page.content()).not.toContain(email);
  await page.goto('/new');
  await page.getByLabel('主题标题').fill('上传图片端到端主题');
  await page.getByLabel('正文', { exact: true }).fill('图片正文');
  await page.getByLabel('选择正文图片', { exact: true }).setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source, 'base64'),
  });
  await expect(page.locator('.image-upload')).toContainText('1600×800 · WebP');
  await page.getByRole('button', { name: '上传图片', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(
    /!\[图片\]\(\/api\/v1\/media\//,
  );
  await page.getByRole('button', { name: '预览 Markdown' }).click();
  await expect(page.getByLabel('Markdown 预览').getByRole('img')).toBeVisible();
  await page.getByRole('button', { name: '发布主题' }).click();
  await expect(page).toHaveURL(/\/t\/[a-f\d-]+$/);
  const image = page.locator('.topic-body img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(
    1600,
  );
  const media = await page.request.get((await image.getAttribute('src'))!);
  expect(media.headers()['content-type']).toBe('image/webp');
  expect(media.headers()['x-content-type-options']).toBe('nosniff');
  await page.getByRole('link', { name: '资料测试成员', exact: true }).click();
  await expect(page).toHaveURL(memberURL);
  await expect(
    page.getByRole('link', { name: '上传图片端到端主题' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto('/settings');
  await page.locator('summary').filter({ hasText: '管理我的图片' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.upload-row')
    .filter({ hasText: '头像' })
    .getByRole('button', { name: '删除图片' })
    .click();
  await expect(page.getByAltText('当前头像')).toHaveCount(0);
  expect((await page.request.get(avatarURL!)).status()).toBe(404);
  expect((await page.goto('/member/no-such-member'))?.status()).toBe(404);
});
