import { z } from 'zod';

export const attachmentLimits = { files: 5, fileBytes: 10 * 1024 * 1024, totalBytes: 25 * 1024 * 1024,
  fileCharacters: 100_000, totalCharacters: 200_000, timeoutMs: 30_000 } as const;
export const attachmentSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(240),
  format: z.enum(['text', 'pdf', 'docx', 'xlsx']), bytes: z.number().int().min(1).max(attachmentLimits.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  characters: z.number().int().min(1).max(attachmentLimits.fileCharacters), parserVersion: z.literal(1),
  warnings: z.array(z.enum(['text-only', 'redacted'])).max(2) }).strict();
export type Attachment = z.infer<typeof attachmentSchema>;
export type ReadableAttachment = Attachment & { text: string };
export const attachmentAccept = '.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.go,.rs,.java,.c,.h,.cpp,.hpp,.cs,.sql,.sh,.ps1,.toml,.ini,.pdf,.docx,.xlsx';
