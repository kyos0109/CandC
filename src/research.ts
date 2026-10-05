import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import { AppError, type Evidence } from './domain.js';
import { redact } from './redaction.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

const blockedNames = /^(?:\.git|\.aws|\.ssh|\.kube|\.docker|\.gnupg|\.azure|\.npmrc|\.git-credentials|\.netrc|\.codex|\.claude|\.agents|node_modules|\.cache|data|dist|id_(?:rsa|dsa|ecdsa|ed25519).*|\.env(?:\..*)?|credentials(?:\..*)?|auth\.json|.*\.(?:pem|key|pfx|p12))$/i;
const MAX_TEXT = 32_000;
const MAX_FILE = 1024 * 1024;
const inRoot = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

export async function validateRoots(roots: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const root of roots) {
    if (!path.isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('//') || /:\\?$/.test(root)) throw new AppError('INVALID_ROOT', 'Select a specific absolute local directory, not a drive or network root.', 400);
    if (process.platform === 'win32') {
      const drive = root.match(/^([a-zA-Z]):[\\/]/)?.[1];
      if (!drive) throw new AppError('INVALID_ROOT', 'Only local drive directories are supported.', 400);
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', `[System.IO.DriveInfo]::new('${drive}:\\').DriveType.ToString()`], { windowsHide: true, timeout: 3_000 });
      if (!['Fixed', 'Removable', 'Ram'].includes(stdout.trim())) throw new AppError('INVALID_ROOT', 'Network drives cannot be selected.', 400);
    }
    const resolved = await realpath(root);
    if (resolved.startsWith('\\\\') || resolved.startsWith('//')) throw new AppError('INVALID_ROOT', 'Network links cannot be selected.', 400);
    if (!(await lstat(resolved)).isDirectory()) throw new AppError('INVALID_ROOT', 'The selected path is not a directory.', 400);
    if (resolved.split(/[\\/]/).some((segment) => blockedNames.test(segment))) throw new AppError('INVALID_ROOT', 'Credential and application-state directories cannot be selected.', 400);
    result.push(resolved);
  }
  return [...new Set(result)];
}

export class ReadOnlyResearch {
  constructor(private readonly roots: string[]) {}
  private async resolve(rootIndex: number, relative: string): Promise<{ target: string; root: string }> {
    const root = this.roots[rootIndex];
    if (!root || path.isAbsolute(relative) || /[:\0]/.test(relative)) throw new AppError('PATH_DENIED', 'Path is outside the authorized roots.');
    const target = path.resolve(root, relative);
    if (!inRoot(root, target) || relative.split(/[\\/]/).some((segment) => blockedNames.test(segment))) throw new AppError('PATH_DENIED', 'Path is blocked.');
    const resolved = await realpath(target);
    if (!inRoot(root, resolved) || resolved.split(/[\\/]/).some((segment) => blockedNames.test(segment))) throw new AppError('PATH_DENIED', 'Linked path is outside the authorized roots or is blocked.');
    return { root, target: resolved };
  }
  async list(rootIndex: number, relative = ''): Promise<string[]> {
    const { target } = await this.resolve(rootIndex, relative);
    const entries = await readdir(target, { withFileTypes: true });
    return entries.filter((entry) => !blockedNames.test(entry.name) && !entry.isSymbolicLink()).slice(0, 250)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }
  async read(rootIndex: number, relative: string, startLine = 1, lines = 150): Promise<Evidence> {
    const { root, target } = await this.resolve(rootIndex, relative);
    const handle = await open(target, 'r');
    let content: string;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE) throw new AppError('FILE_LIMIT', 'Only text files up to 1 MiB may be read.');
      const buffer = Buffer.alloc(MAX_FILE + 1);
      let count = 0;
      while (count < buffer.length) { const next = await handle.read(buffer, count, buffer.length - count, null); if (!next.bytesRead) break; count += next.bytesRead; }
      if (count > MAX_FILE) throw new AppError('FILE_LIMIT', 'The file grew beyond the text limit.');
      const bytes = buffer.subarray(0, count);
      if (bytes.includes(0)) throw new AppError('BINARY_FILE', 'Binary files are not supported.');
      content = bytes.toString('utf8');
    } finally { await handle.close(); }
    // Redact with full-file context before selecting lines inside a secret block.
    const allLines = redact(content, true).split(/\r?\n/);
    const selected = allLines.slice(startLine - 1, startLine - 1 + Math.min(lines, 300));
    const text = selected.map((line, index) => `${startLine + index}: ${line}`).join('\n');
    return evidence(`${root}/${path.relative(root, target).replaceAll('\\', '/')}#L${startLine}`, text, text.length > MAX_TEXT || startLine > 1 || allLines.length > selected.length);
  }
  async search(rootIndex: number, query: string): Promise<Evidence> {
    const root = this.roots[rootIndex];
    if (!root) throw new AppError('PATH_DENIED', 'Unknown root.');
    const matches: string[] = [];
    const pending = [''];
    let visited = 0;
    while (pending.length && visited < 2_000 && matches.length < 100) {
      const relative = pending.shift()!;
      const { target } = await this.resolve(rootIndex, relative);
      for (const entry of await readdir(target, { withFileTypes: true })) {
        if (++visited > 2_000 || matches.length >= 100) break;
        if (blockedNames.test(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) pending.push(file);
        else if (entry.isFile()) {
          try {
            const result = await this.read(rootIndex, file, 1, 300);
            for (const line of result.text.split('\n')) {
              if (line.toLowerCase().includes(query.toLowerCase())) matches.push(`${file.replaceAll('\\', '/')}:${line}`);
              if (matches.length >= 100) break;
            }
          } catch (error) { if (!(error instanceof AppError)) throw error; }
        }
      }
    }
    return evidence(`${root} (literal search: ${redact(query)})`, matches.join('\n') || 'No matches in the bounded search.', visited >= 2_000 || matches.length >= 100);
  }
}

export function evidence(source: string, raw: string, truncated = false): Evidence {
  const text = redact(raw).slice(0, MAX_TEXT);
  return { source: redact(source), text, sha256: createHash('sha256').update(text).digest('hex'), retrievedAt: new Date().toISOString(), truncated: truncated || raw.length > MAX_TEXT };
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function fetchPublicPage(raw: string, redirects = 0): Promise<Evidence> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new AppError('URL_DENIED', 'Only public HTTPS URLs without credentials are allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address))) throw new AppError('URL_DENIED', 'Private and local network addresses are blocked.');
  const address = addresses[0]!;
  const result = await new Promise<{ location?: string; body: string }>((resolve, reject) => {
    const request = httpsRequest(url, {
      headers: { 'User-Agent': 'CandC/0.2 public-research', Accept: 'text/html,text/plain' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume(); resolve({ location: response.headers.location, body: '' }); return;
      }
      if (response.statusCode !== 200 || !/^(text\/|application\/json)/i.test(response.headers['content-type'] ?? '')) {
        response.resume(); reject(new AppError('FETCH_FAILED', 'The public URL did not return supported text.')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) { request.destroy(new AppError('FETCH_LIMIT', 'Public page exceeded 512 KiB.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    const timeout = setTimeout(() => request.destroy(new AppError('FETCH_TIMEOUT', 'Public page timed out.')), 15_000);
    request.once('close', () => clearTimeout(timeout));
    request.on('error', reject);
    request.end();
  });
  if (result.location) {
    if (redirects >= 3) throw new AppError('REDIRECT_LIMIT', 'Too many redirects.');
    return fetchPublicPage(new URL(result.location, url).href, redirects + 1);
  }
  const text = result.body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return evidence(url.href, text);
}
