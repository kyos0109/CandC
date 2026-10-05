import { readFile, appendFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ReadOnlyResearch, fetchPublicPage, validateRoots } from './research.js';
import { safeError } from './redaction.js';

const config = z.object({ roots: z.array(z.string()), evidenceFile: z.string() }).parse(JSON.parse(await readFile(process.argv[2]!, 'utf8')));
const research = new ReadOnlyResearch(await validateRoots(config.roots));
const server = new McpServer({ name: 'candc-research', version: '0.2.0' });
const rootIndex = z.number().int().min(0).max(7);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
async function result(action: () => Promise<unknown>) {
  try {
    const value = await action();
    if (value && typeof value === 'object' && 'sha256' in value) await appendFile(config.evidenceFile, JSON.stringify(value) + '\n');
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: safeError(error) }] }; }
}
server.registerTool('list_files', { annotations, description: 'List files inside an authorized local root; no shell or writes.', inputSchema: { rootIndex, relative: z.string().default('') } },
  ({ rootIndex, relative }) => result(() => research.list(rootIndex, relative)));
server.registerTool('read_text', { annotations, description: 'Read a bounded range of a text file. Cite the returned source and hash.', inputSchema: { rootIndex, relative: z.string(), startLine: z.number().int().min(1).default(1), lines: z.number().int().min(1).max(300).default(150) } },
  ({ rootIndex, relative, startLine, lines }) => result(() => research.read(rootIndex, relative, startLine, lines)));
server.registerTool('search_text', { annotations, description: 'Bounded literal text search in an authorized local root.', inputSchema: { rootIndex, query: z.string().min(1).max(200) } },
  ({ rootIndex, query }) => result(() => research.search(rootIndex, query)));
server.registerTool('fetch_public_page', { annotations: { ...annotations, openWorldHint: true }, description: 'Fetch public HTTPS text; local/private IPs, cookies and credentials are disallowed.', inputSchema: { url: z.string().url() } },
  ({ url }) => result(() => fetchPublicPage(url)));
await server.connect(new StdioServerTransport());
