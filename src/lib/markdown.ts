import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

// Shared server pipeline for SSR and previews. Never accept raw user HTML.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeStringify)
  .freeze();
export async function renderMarkdown(markdown: string): Promise<string> {
  return String(await processor.process(markdown));
}
