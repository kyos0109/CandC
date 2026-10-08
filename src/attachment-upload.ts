import type { FastifyRequest } from 'fastify';
import { mkdtemp, open, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './domain.js';
import { attachmentLimits } from './attachment-contract.js';
import { extractAttachment, type UploadedFile, type PreparedAttachment } from './attachments.js';

export class AttachmentUploadError extends AppError {
  constructor(code: string, readonly fileName: string, statusCode = 422) { super(code, 'Attachment processing failed.', statusCode); }
}
export async function prepareAttachments(files: UploadedFile[]): Promise<PreparedAttachment[]> {
  const prepared: PreparedAttachment[] = []; let characters = 0;
  for (const file of files) {
    try {
      const result = await extractAttachment(file); characters += result.metadata.characters;
      if (characters > attachmentLimits.totalCharacters) throw new AppError('ATTACHMENT_TEXT_LIMIT', 'Combined attachment text limit exceeded.', 413);
      prepared.push(result);
    } catch (error) { throw new AttachmentUploadError(error instanceof AppError ? error.code : 'ATTACHMENT_INVALID', file.name, error instanceof AppError ? error.statusCode : 422); }
  }
  return prepared;
}
export async function withUpload<T>(request: FastifyRequest, action: (payload: unknown, files: UploadedFile[]) => Promise<T>): Promise<T> {
  // Multipart streams have explicit byte limits below; JSON retains Fastify's 128 KiB parser limit.
  if (!request.isMultipart()) return action(request.body, []);
  const directory = await mkdtemp(path.join(tmpdir(), 'candc-upload-')), paths: string[] = [], files: UploadedFile[] = [];
  let payload: unknown, hasPayload = false, total = 0;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname !== 'payload' || hasPayload || part.valueTruncated || typeof part.value !== 'string') throw new AppError('INVALID_INPUT', 'Expected one payload field.', 400);
        try { payload = JSON.parse(part.value); } catch { throw new AppError('INVALID_INPUT', 'Invalid payload JSON.', 400); }
        hasPayload = true; continue;
      }
      if (!hasPayload || part.fieldname !== 'files') throw new AppError('INVALID_INPUT', 'Payload must precede attachment files.', 400);
      const target = path.join(directory, randomUUID()), handle = await open(target, 'wx', 0o600); paths.push(target);
      let bytes = 0; const hash = createHash('sha256');
      try {
        for await (const chunk of part.file) {
          bytes += chunk.length; total += chunk.length;
          if (bytes > attachmentLimits.fileBytes || total > attachmentLimits.totalBytes) throw new AttachmentUploadError('ATTACHMENT_SIZE', part.filename, 413);
          hash.update(chunk); await handle.writeFile(chunk);
        }
        if (part.file.truncated) throw new AttachmentUploadError('ATTACHMENT_SIZE', part.filename, 413);
      } finally { await handle.close(); }
      files.push({ name: part.filename, bytes, sha256: hash.digest('hex'), path: target });
    }
    if (!hasPayload) throw new AppError('INVALID_INPUT', 'Missing payload.', 400);
    return await action(payload, files);
  } finally {
    for (const file of paths) await unlink(file).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
}
