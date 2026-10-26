import type { Root, RootContent, Link, Text, Parent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const ignored = new Set([
  'code',
  'inlineCode',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'html',
  'blockquote',
]);
const pattern =
  /(?<![A-Za-z0-9_@./-])@([A-Za-z0-9_][A-Za-z0-9_-]{0,79})(?![A-Za-z0-9_-])/g;
function walk(tree: Root, link: boolean) {
  const names = new Set<string>();
  function visit(node: Root | RootContent) {
    if (ignored.has(node.type) || !('children' in node)) return;
    const parent: Parent = node;
    parent.children = parent.children.flatMap<RootContent>((child) => {
      if (child.type !== 'text') {
        visit(child);
        return [child];
      }
      const parts: (Text | Link)[] = [];
      let offset = 0;
      for (const match of child.value.matchAll(pattern)) {
        const username = match[1]!;
        if (!names.has(username) && names.size >= 20) continue;
        names.add(username);
        if (link) {
          parts.push(
            { type: 'text', value: child.value.slice(offset, match.index) },
            {
              type: 'link',
              url: `/member/${encodeURIComponent(username)}`,
              children: [{ type: 'text', value: match[0] }],
            },
          );
          offset = match.index + match[0].length;
        }
      }
      return link && parts.length
        ? [...parts, { type: 'text', value: child.value.slice(offset) }]
        : [child];
    });
  }
  visit(tree);
  return [...names];
}
export function mentionNames(markdown: string) {
  return walk(parser.parse(markdown), false);
}
export function remarkMentions() {
  return (tree: Root) => {
    walk(tree, true);
  };
}
