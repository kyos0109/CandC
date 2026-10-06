import { z } from 'zod';

export const folderSchema = z.enum(['active', 'archived', 'trash']);
export const managementActionSchema = z.enum(['archive', 'unarchive', 'trash', 'restore']);
export const managementSchema = z.object({
  folder: folderSchema, changedAt: z.iso.datetime(), previousFolder: z.enum(['active', 'archived']).nullable(),
  operationId: z.uuid(), action: managementActionSchema,
}).strict().superRefine((value, ctx) => {
  if ((value.folder === 'trash') !== (value.previousFolder !== null)) ctx.addIssue({ code: 'custom', message: 'Trash requires its previous folder.' });
});
export type Management = z.infer<typeof managementSchema>;
export type Folder = z.infer<typeof folderSchema>;
export type ManagementAction = z.infer<typeof managementActionSchema>;
