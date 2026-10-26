import { expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';
it('renders GFM, quotes, links and highlighted fenced code', async () => {
  const html = await renderMarkdown(
    '# 标题\n\n**重点** ~~删除线~~ [链接](https://example.com)\n\n> 引用\n\n| 列 | 值 |\n| - | - |\n| a | b |\n\n```js\nconst answer = 42;\n```',
  );
  expect(html).toContain('<h1>标题</h1>');
  expect(html).toContain('<strong>重点</strong>');
  expect(html).toContain('<del>删除线</del>');
  expect(html).toContain('<table>');
  expect(html).toContain('<blockquote>');
  expect(html).toContain('hljs-keyword');
});
it('removes raw HTML and dangerous link/image protocols', async () => {
  const html = await renderMarkdown(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29)\n\n![x](data:image/svg+xml;base64,PHN2Zz4=)\n\n<iframe src="https://evil.example"></iframe>\n\n[safe](https://example.com)',
  );
  expect(html).not.toMatch(/<script|onerror|javascript:|data:|iframe/i);
  expect(html).toContain('href="https://example.com"');
});
it('keeps code inert and never permits DOM clobbering or forged footer markup', async () => {
  const html = await renderMarkdown(
    '```html\n<script>alert(1)</script>\n```\n\n<a id="location" name="__proto__">bad</a>\n\n<span data-server-timing>Server —</span>',
  );
  expect(html).toContain('&#x3C;');
  expect(html).not.toMatch(
    /<script|id="location"|name="__proto__"|data-server-timing/,
  );
});
it('handles unknown code languages without enabling raw HTML', async () => {
  expect(
    await renderMarkdown('```unknown-language\n<script>x</script>\n```'),
  ).toContain('&#x3C;script>');
});
