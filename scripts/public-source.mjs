import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_ROOT_FILES = ['.gitignore', '.gitleaks.toml', 'package.json', 'package-lock.json', 'README.md', 'VALIDATION.md',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'Start-CandC.cmd', 'Stop-CandC.cmd', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'vite.config.ts', 'playwright.config.ts'];
const directories = ['src', 'web', 'tests', 'e2e', 'scripts', 'docs', 'licenses', '.github'];
const extensions = new Set(['.ts', '.tsx', '.css', '.html', '.svg', '.md', '.mjs', '.json', '.ps1', '.cmd', '.yml', '.yaml', '.toml', '.txt']);
const forbidden = /(?:^|\/)(?:\.git|\.cache|\.codex|\.agents|\.aws|data|node_modules|dist|web-dist|coverage|\.env(?:\..*)?|credentials?|auth\.json)(?:\/|$)|\.(?:pem|key|pfx|p12|log|jsonl)$/i;

/** Explicit source allowlist, independent of Git tracking and ignored local data. */
export async function publicSourceFiles(root = process.cwd()) {
  const files = [];
  async function inspect(relative, required = true) {
    let entry;
    try { entry = await lstat(path.join(root, relative)); }
    catch (error) { if (!required && error.code === 'ENOENT') return; throw error; }
    if (entry.isSymbolicLink()) throw new Error(`Public export refuses symlinks: ${relative}`);
    if (entry.isDirectory() && /(?:^|\/)(?:\.cache|node_modules|coverage|dist|web-dist)$/.test(relative)) return;
    if (forbidden.test(relative)) throw new Error(`Private or runtime file in source allowlist: ${relative}`);
    if (entry.isDirectory()) {
      for (const child of await readdir(path.join(root, relative))) await inspect(`${relative}/${child}`);
    } else {
      if (!entry.isFile() || entry.size > 8 * 1024 * 1024 || !extensions.has(path.extname(relative)) && !['.gitignore', 'LICENSE', 'src/generated/codex/VERSION'].includes(relative)) {
        throw new Error(`Unexpected source artifact requires review: ${relative}`);
      }
      files.push(relative);
    }
  }
  for (const file of PUBLIC_ROOT_FILES) await inspect(file);
  for (const directory of directories) await inspect(directory, false);
  return files.sort();
}
