import { test, expect } from '@playwright/test';

test('theme menu supports pointer, keyboard, persistence and live system appearance', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /^外观：/ });
  const menu = page.getByRole('menu', { name: '外观' });
  const option = (name: string) =>
    page.getByRole('menuitemradio', { name, exact: true });
  await expect(trigger).toHaveAccessibleName('外观：跟随系统');
  const box = await trigger.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  for (const name of ['浅色', '深色', '浅色', '深色']) {
    await trigger.click();
    await option(name).click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('html')).toHaveCSS(
      'color-scheme',
      name === '浅色' ? 'light' : 'dark',
    );
  }
  await page.reload();
  await expect(trigger).toHaveAccessibleName('外观：深色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(option('深色')).toBeFocused();
  await expect(option('深色')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(option('跟随系统')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAccessibleName('外观：跟随系统');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.theme-moon')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('.theme-sun')).toBeVisible();
  await page.reload();
  await expect(trigger).toHaveAccessibleName('外观：跟随系统');
  await trigger.press('Space');
  await page.keyboard.press('Home');
  await expect(option('浅色')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(option('跟随系统')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(option('浅色')).toBeFocused();
  await page.keyboard.press('Space');
  await trigger.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('#main').click({ position: { x: 3, y: 3 } });
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await trigger.click();
  await trigger.click();
  await expect(menu).toBeHidden();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({
    path: testInfo.outputPath('theme-light.png'),
    fullPage: true,
  });
  await trigger.click();
  await expect(option('浅色')).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({
    path: testInfo.outputPath('theme-menu-light.png'),
    fullPage: true,
  });
  await option('深色').click();
  await page.screenshot({
    path: testInfo.outputPath('theme-dark.png'),
    fullPage: true,
  });
  await trigger.click();
  await page.screenshot({
    path: testInfo.outputPath('theme-menu-dark.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const header = page.locator('.header-inner');
  expect((await header.boundingBox())!.height).toBeLessThan(100);
  await trigger.click();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
});

test('saved theme is applied before hydration and storage failure stays usable', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  // Block the React bundle to verify the existing inline head script independently.
  await context.route('**/_astro/*.js', (route) => route.abort());
  await context.addInitScript(() =>
    localStorage.setItem('forum-theme', 'dark'),
  );
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.theme-moon')).toBeVisible();
  await context.close();

  const active = await browser.newPage();
  await active.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await active.goto(baseURL!);
  await active.getByRole('button', { name: /^外观：/ }).click();
  await active
    .getByRole('menuitemradio', { name: '深色', exact: true })
    .click();
  await expect(active.locator('html')).toHaveAttribute('data-theme', 'dark');
  await active.close();
});
