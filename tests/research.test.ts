import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ReadOnlyResearch, isPublicAddress, validateRoots, fetchPublicPage } from '../src/research.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('read-only research boundaries', () => {
  const fixtureParent = path.resolve(tmpdir());
  let directory: string;
  let research: ReadOnlyResearch;
  const sensitiveDirectories = ['.kube', '.docker', '.gnupg', '.azure'];
  const sensitiveFiles = ['.npmrc', '.git-credentials', '.netrc', 'id_rsa', 'id_rsa.backup', 'id_ed25519', 'id_dsa', 'id_ecdsa', 'ID_RSA_COPY'];
  beforeAll(async () => {
    directory = await mkdtemp(path.join(fixtureParent, 'candc-research-fixture-'));
    await writeFile(path.join(directory, 'notes.txt'), 'Recovery takes 30 seconds.\npassword=fixture-secret\nCost is bounded.');
    await writeFile(path.join(directory, '.env'), 'API_KEY=fixture');
    await writeFile(path.join(directory, 'binary.dat'), Buffer.from([0,1,2]));
    await writeFile(path.join(directory, 'large.txt'), 'x'.repeat(1024*1024+1));
    await mkdir(path.join(directory, 'nested')); await writeFile(path.join(directory, 'nested/more.txt'), 'Recovery should be measured.');
    for (const name of sensitiveDirectories) {
      await mkdir(path.join(directory, name));
      await writeFile(path.join(directory, name, 'config'), 'credential-fixture-marker');
    }
    for (const name of sensitiveFiles) await writeFile(path.join(directory, name), 'credential-fixture-marker');
    await writeFile(path.join(directory, 'nested/id_rsa.backup'), 'credential-fixture-marker');
    research = new ReadOnlyResearch(await validateRoots([directory]));
  });
  afterAll(async () => { if (directory && path.dirname(directory) === fixtureParent && path.basename(directory).startsWith('candc-research-fixture-')) await rm(directory, { recursive: true, force: true }); });
  it('reads numbered lines, redacts secrets and records a verifiable hash', async () => {
    const result = await research.read(0, 'notes.txt');
    expect(result.text).toContain('1: Recovery'); expect(result.text).not.toContain('fixture-secret'); expect(result.sha256).toHaveLength(64);
    expect(await research.list(0)).not.toContain('.env');
    expect((await research.search(0, 'Recovery')).text).toContain('nested/more.txt');
  });
  it('redacts a key and multiline quoted secret before slicing while preserving line numbers', async () => {
    await writeFile(path.join(directory, 'secret-notes.txt'), '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_KEY_BODY\n-----END PRIVATE KEY-----\npassword="synthetic\npassphrase"\nSafe ending');
    const key = await research.read(0, 'secret-notes.txt', 2, 1);
    expect(key.text).toBe('2: [REDACTED PRIVATE KEY]');
    expect((await research.read(0, 'secret-notes.txt', 5, 1)).text).not.toContain('passphrase');
    expect((await research.read(0, 'secret-notes.txt', 6, 1)).text).toBe('6: Safe ending');
    expect((await research.search(0, 'SYNTHETIC_KEY_BODY')).text).toBe('No matches in the bounded search.');
  });
  it.each(['../outside.txt', '.env', 'C:\\Windows\\test.txt', 'notes.txt:stream'])('rejects unauthorized path %s', async file => { await expect(research.read(0,file)).rejects.toMatchObject({code:'PATH_DENIED'}); });
  it.each([...sensitiveFiles, ...sensitiveDirectories.map(name => `${name}/config`), 'nested/id_rsa.backup'])('rejects sensitive file %s', async file => {
    await expect(research.read(0, file)).rejects.toMatchObject({ code: 'PATH_DENIED' });
  });
  it('excludes credential files from listings and search results', async () => {
    const names = await research.list(0);
    for (const name of [...sensitiveFiles, ...sensitiveDirectories]) expect(names).not.toContain(name);
    for (const name of sensitiveDirectories) expect(names).not.toContain(`${name}/`);
    expect(await research.list(0, 'nested')).not.toContain('id_rsa.backup');
    expect((await research.search(0, 'credential-fixture-marker')).text).toBe('No matches in the bounded search.');
  });
  it.each(sensitiveDirectories)('rejects direct access and root selection for %s', async name => {
    await expect(research.list(0, name)).rejects.toMatchObject({ code: 'PATH_DENIED' });
    await expect(validateRoots([path.join(directory, name)])).rejects.toMatchObject({ code: 'INVALID_ROOT' });
  });
  it('rejects binary and oversized files', async () => { await expect(research.read(0,'binary.dat')).rejects.toMatchObject({code:'BINARY_FILE'}); await expect(research.read(0,'large.txt')).rejects.toMatchObject({code:'FILE_LIMIT'}); });
  it('rejects directory links escaping the selected root', async () => { await symlink(path.resolve('src'),path.join(directory,'escape'),process.platform === 'win32' ? 'junction' : 'dir'); await expect(research.read(0,'escape/domain.ts')).rejects.toMatchObject({code:'PATH_DENIED'}); });
  it('rejects the filesystem root', async () => { await expect(validateRoots([path.parse(directory).root])).rejects.toMatchObject({ code: 'INVALID_ROOT' }); });
  it.each(['127.0.0.1','10.1.2.3','172.16.0.1','192.168.2.3','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])('rejects private address %s', address => { expect(isPublicAddress(address)).toBe(false); });
  it('rejects private fetch URLs before opening a connection', async () => { await expect(fetchPublicPage('https://127.0.0.1')).rejects.toMatchObject({code:'URL_DENIED'}); await expect(fetchPublicPage('http://example.com')).rejects.toMatchObject({code:'URL_DENIED'}); });
  it('serves only the four bounded research tools over real MCP stdio', async () => {
    const id = randomUUID(); const config = path.resolve(`.cache/mcp-${id}.json`); const evidenceFile = path.resolve(`.cache/mcp-${id}.jsonl`);
    await writeFile(config, JSON.stringify({ roots:[directory], evidenceFile }));
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import','tsx','src/mcp.ts',config], cwd:process.cwd(), stderr:'ignore' });
    const client = new Client({ name:'candc-test',version:'1.0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool=>tool.name).sort()).toEqual(['fetch_public_page','list_files','read_text','search_text']);
      const result = await client.callTool({name:'read_text',arguments:{rootIndex:0,relative:'notes.txt'}});
      expect(JSON.stringify(result)).toContain('Recovery'); expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect((await readFile(evidenceFile,'utf8'))).toContain('sha256');
      expect((await client.callTool({name:'read_text',arguments:{rootIndex:0,relative:'.env'}})).isError).toBe(true);
    } finally { await client.close(); await rm(config,{force:true}); await rm(evidenceFile,{force:true}); }
  });
});
