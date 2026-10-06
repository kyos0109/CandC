// Embedded into the standalone shell/PowerShell entrypoints by package-release.mjs.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

try {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node.js 24.x is required. Install it from https://nodejs.org/en/download and retry.');
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Install CandC: [--repo OWNER/REPO] [--version vX.Y.Z] [--install-dir PATH] [--port PORT] [--no-start] [--no-browser]');
  } else {
    const value = key => { const i = args.lastIndexOf(key); return i < 0 ? undefined : args[i + 1]; };
    const repo = value('--repo') ?? '__CANDC_REPOSITORY__';
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Supply --repo OWNER/REPO (PowerShell: -Repo OWNER/REPO).');
    const get = async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'CandC-bootstrap' } });
      if (!response.ok || !response.url.startsWith('https://')) throw new Error(`Download failed (HTTP ${response.status}). Check the repository/version, network and GitHub rate limits, then retry.`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Bootstrap download is too large.'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    };
    let version = value('--version');
    if (!version) {
      const release = JSON.parse((await get(`https://api.github.com/repos/${repo}/releases/latest`)).toString());
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('No stable release found. Specify --version.');
      version = release.tag_name;
    }
    if (!version.startsWith('v')) version = `v${version}`;
    if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(version)) throw new Error('Invalid release version.');
    const base = `https://github.com/${repo}/releases/download/${version}`;
    const [script, sums] = await Promise.all([get(`${base}/install.mjs`), get(`${base}/SHA256SUMS`)]);
    const expected = sums.toString().split(/\r?\n/).filter(line => /^[a-f0-9]{64}\s+install\.mjs$/.test(line));
    if (expected.length !== 1 || expected[0].slice(0, 64) !== createHash('sha256').update(script).digest('hex')) throw new Error('Installer checksum mismatch. Download the release again.');
    const directory = await mkdtemp(path.join(tmpdir(), 'candc-bootstrap-'));
    try {
      const file = path.join(directory, 'install.mjs'); await writeFile(file, script, { mode: 0o600 });
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [file, ...args, '--repo', repo, '--version', version], { stdio: 'inherit', windowsHide: true });
        child.once('error', () => reject(new Error('Could not start the installer. Check Node.js permissions.')));
        child.once('close', code => resolve(code ?? 1));
      });
      process.exitCode = code;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
} catch (error) { console.error(`CandC: ${error.message}`); process.exitCode = 1; }
