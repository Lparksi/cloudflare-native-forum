import { z } from 'zod';

export const topicInput = z
  .object({
    title: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .refine((value) => !value.includes('\0'), '不允许 NUL 字符'),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .refine((value) => !value.includes('\0'), '不允许 NUL 字符'),
    nodeId: z.string().min(1).max(64),
    requestId: z.uuid(),
  })
  .strict();
export const topicCursor = z
  .object({ createdAt: z.number().int().nonnegative(), id: z.uuid() })
  .strict();
export type TopicInput = z.infer<typeof topicInput>;
export type TopicCursor = z.infer<typeof topicCursor>;

export function parseCursor(value: string | null): TopicCursor | undefined {
  if (value === null) return undefined;
  if (value.length > 200) throw new Error('Invalid cursor');
  return topicCursor.parse(JSON.parse(value));
}

export function localWriteAllowed(mode: string, url: string): boolean {
  return (
    mode === 'local' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  );
}
