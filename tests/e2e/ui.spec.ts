import { test, expect, type Page } from '@playwright/test';
import { registerAndLogin } from './auth-helpers';

async function expectNoPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

// Computed font-family alone cannot reveal which installed font rendered CJK.
// Log only font metadata from these synthetic local fixtures, never page data.
async function recordRenderedFonts(
  page: Page,
  selectors: string[],
  stage = 'before-capture',
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    for (const selector of selectors) {
      const { nodeId } = await session.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });
      expect(nodeId).not.toBe(0);
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', {
        nodeId,
      });
      const expectedFont = process.env.UI_EXPECT_CJK_FONT;
      if (expectedFont) {
        expect(fonts.some((font) => font.familyName === expectedFont)).toBe(
          true,
        );
        // This existing node label is entirely Chinese: no hidden fallback.
        if (selector === '.node-chip') {
          expect(fonts.map((font) => font.familyName)).toEqual([expectedFont]);
        }
      }
      const fontFamily = await page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily);
      console.log(
        'UI rendered fonts:',
        JSON.stringify({ stage, selector, fontFamily, fonts }),
      );
    }
  } finally {
    await session.detach();
  }
}

// These fixtures go through the real authenticated local API. Never use a
// deployed endpoint, direct SQL, or mocked response for visual evidence.
async function createLocalContent(
  page: Page,
  action: 'topic' | 'reply',
  path: string,
  data: Record<string, string>,
) {
  const origin = new URL(page.url()).origin;
  expect(origin).toBe('http://127.0.0.1:4321');
  const proof = await page.request.post('/api/v1/security/challenge', {
    headers: { origin },
    data: { action },
  });
  expect(proof.status()).toBe(200);
  const { data: challenge } = (await proof.json()) as {
    data: { token: string };
  };
  const response = await page.request.post(path, {
    headers: { origin, 'x-turnstile-token': challenge.token },
    data: { ...data, requestId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

test('0xca feed navigation preserves search, resets cursors and supports browser history', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle('社区讨论 · 0xca');
  await expect(page.getByRole('link', { name: '0xca 首页' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('边集');
  await expect(page.locator('main > .intro')).toHaveCount(0);

  // The skip link must remain the first keyboard stop, including on mobile.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到正文' })).toBeFocused();
  await expect(page.getByRole('link', { name: '跳到正文' })).toBeVisible();

  const form = page.getByRole('search');
  await form.getByLabel('搜索讨论').fill('本地界面预览');
  await form.getByRole('button', { name: '查看', exact: true }).click();
  const sorts = page.getByRole('navigation', { name: '讨论排序' });
  await sorts.getByRole('link', { name: '热门', exact: true }).click();
  await expect(sorts.getByRole('link', { name: '热门' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(new URL(page.url()).searchParams.get('q')).toBe('本地界面预览');
  const homeURL = page.url();
  await page
    .getByRole('navigation', { name: '讨论节点' })
    .getByRole('link', { name: '开发技术', exact: true })
    .click();
  expect(new URL(page.url()).pathname).toBe('/go/dev');
  expect(new URL(page.url()).searchParams.get('sort')).toBe('hot');
  await expect(form.getByLabel('搜索讨论')).toHaveValue('本地界面预览');
  const nodeURL = page.url();
  await page.goBack();
  await expect(page).toHaveURL(homeURL);
  await page.goForward();
  await expect(page).toHaveURL(nodeURL);

  // A valid but exhausted feed cursor must not leak into the new selection.
  const cursor = JSON.stringify({
    createdAt: 0,
    id: '00000000-0000-4000-8000-000000000000',
    sort: 'hot',
    rank: 0,
    q: '本地界面预览',
  });
  await page.goto(`${nodeURL}&cursor=${encodeURIComponent(cursor)}`);
  await sorts.getByRole('link', { name: '活跃', exact: true }).click();
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
  expect(new URL(page.url()).searchParams.get('q')).toBe('本地界面预览');
  await page
    .getByRole('navigation', { name: '讨论节点' })
    .getByRole('link', { name: '全部', exact: true })
    .click();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).searchParams.get('sort')).toBe('active');

  for (const width of [
    320,
    390,
    testInfo.project.name === 'desktop' ? 1280 : 390,
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoPageOverflow(page);
    await expect(page.getByRole('link', { name: '＋ 发起讨论' })).toBeVisible();
  }
});

test('local UI review captures compact feeds and safe continuous discussions', async ({
  page,
  context,
}, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.18.3.${Math.floor(Math.random() * 200) + 1}`,
  });
  await registerAndLogin(page);
  await page.getByLabel('显示名称', { exact: true }).fill('本地预览成员');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('资料已保存。', { exact: true })).toBeVisible();

  const body = [
    '这是一条通过本地 API 保存的界面验收主题，不是线上社区数据。',
    '## 让讨论回到内容本身',
    '首页保留连续话题列表，详情采用稳定楼层。代码和表格只在自身区域横向滚动。',
    '```ts\nconst endpoint = "https://example.com/' +
      'a'.repeat(180) +
      '";\n```',
    '| 项目 | 桌面体验 | 手机体验 |\n| --- | --- | --- |\n| 导航 | 主列与右侧栏 | 单列与横向节点 |',
    '> 这段引用也来自本地测试内容。',
  ].join('\n\n');
  const topics = [
    ['dev', '本地界面预览：让一次代码评审更有效'],
    ['cloud', '本地界面预览：边缘部署中的小经验'],
    ['share', '本地界面预览：最近发现的轻量开发工具'],
    [
      'dev',
      '本地界面预览：一个长标题在手机与桌面上的自然换行，以及信息密度的取舍',
    ],
    ['dev', '本地界面预览：0xca 的第一场讨论'],
  ];
  const created: string[] = [];
  for (const [nodeId, title] of topics) {
    created.push(
      await createLocalContent(page, 'topic', '/api/v1/topics', {
        nodeId,
        title,
        body,
      }),
    );
  }
  const id = created.at(-1)!;
  for (const reply of [
    '连续楼层让讨论上下文更清楚。这里是第一条本地验收回复。',
    '也检查了较长内容的换行；少一些装饰，把空间留给观点。',
  ]) {
    await createLocalContent(page, 'reply', `/api/v1/topics/${id}/replies`, {
      body: reply,
    });
  }

  await page.goto('/');
  await page.getByRole('combobox', { name: '外观' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.topic-row').first()).toContainText(
    topics.at(-1)![1],
  );
  await expectNoPageOverflow(page);
  await recordRenderedFonts(page, ['.topic-title', '.node-chip']);
  await page.screenshot({
    path: testInfo.outputPath('home-light.png'),
    fullPage: true,
  });
  await recordRenderedFonts(page, ['.topic-title'], 'after-home-capture');

  await page
    .locator('.topic-row')
    .first()
    .getByRole('link', { name: /^2 条回复：/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/t/${id}#replies$`));
  await expect(page.getByRole('region', { name: '回复列表' })).toBeVisible();
  await expect(page.locator('.reply-row')).toHaveCount(2);
  await expect(page.locator('.reply-floor').first()).toHaveText('#1');
  await expect(page.locator('.reply-floor').last()).toHaveText('#2');

  const width = testInfo.project.name === 'mobile' ? 390 : 1280;
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/t/${id}`);
  await expectNoPageOverflow(page);
  await expect(page.locator('.topic-body pre')).toBeVisible();
  await expect(page.locator('.topic-body table')).toBeVisible();
  expect(
    await page
      .locator('.topic-body pre')
      .evaluate((element) => getComputedStyle(element).overflowX),
  ).toBe('auto');
  expect(
    await page
      .locator('.topic-body table')
      .evaluate((element) => getComputedStyle(element).overflowX),
  ).toBe('auto');
  await recordRenderedFonts(page, ['h1', '.topic-body p']);
  await page.screenshot({
    path: testInfo.outputPath('topic-light.png'),
    fullPage: true,
  });

  await page.getByRole('combobox', { name: '外观' }).selectOption('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await recordRenderedFonts(page, ['h1', '.topic-body p']);
  await page.screenshot({
    path: testInfo.outputPath('topic-dark.png'),
    fullPage: true,
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await recordRenderedFonts(page, ['.topic-title', '.node-chip']);
  await page.screenshot({
    path: testInfo.outputPath('home-dark.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/t/${id}`);
  await expectNoPageOverflow(page);
  await page.getByRole('combobox', { name: '外观' }).selectOption('light');
  await expectNoPageOverflow(page);

  // A valid 80-character unbroken display name must wrap without clipping
  // the page or hiding the reply controls at the narrowest supported width.
  await page.goto('/settings');
  await page.getByLabel('显示名称', { exact: true }).fill('A'.repeat(80));
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('资料已保存。', { exact: true })).toBeVisible();
  await page.goto('/');
  await expectNoPageOverflow(page);
  await page.goto(`/t/${id}`);
  await expectNoPageOverflow(page);

  // Remove only this test's own fixtures so the other viewport gets a clean
  // review. The isolated E2E database and screenshots remain local-only.
  for (const topicId of created) {
    const response = await page.request.delete(`/api/v1/topics/${topicId}`, {
      headers: { origin: 'http://127.0.0.1:4321' },
      data: { revision: 1 },
    });
    expect(response.status()).toBe(200);
  }
});
