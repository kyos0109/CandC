import { gzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNode, runCommand, sha256 } from './install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function makeArchive(entries) {
  const blocks = [];
  for (const { name, bytes } of entries) {
    const header = Buffer.alloc(512);
    let basename = name, prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/'); prefix = name.slice(0, split); basename = name.slice(split + 1);
    }
    if (Buffer.byteLength(basename) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Release filename exceeds ustar limits.');
    header.write(basename, 0, 100);
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
    octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263); header.write(prefix, 345, 155);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
export async function packageRelease({ build, output, repo } = {}) {
  checkNode();
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = `v${pkg.version}`;
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(version)) throw new Error('Invalid package version.');
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Use --repo OWNER/REPO.');
  const cache = path.join(root, '.cache');
  build = path.resolve(build ?? path.join(cache, 'release-build'));
  output = path.resolve(output ?? path.join(cache, 'release', version));
  for (const directory of [build, output]) if (!directory.startsWith(cache + path.sep)) throw new Error('Release build/output must stay inside the workspace .cache directory.');
  const entries = [];
  async function collect(directory, name) {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) throw new Error('Release refuses symlinks.');
    if (stat.isDirectory()) { for (const child of (await readdir(directory)).sort()) await collect(path.join(directory, child), `${name}/${child}`); }
    else if (stat.isFile()) {
      if (/^(?:dist|web-dist)\//.test(name) && (!['.js', '.css', '.html', '.svg'].includes(path.extname(name)) || /(?:^|\/)(?:data|node_modules|\.cache|\.env(?:\..*)?|credentials?|auth\.json)(?:\/|$)/i.test(name))) throw new Error(`Unexpected/private build artifact: ${name}. Use a clean isolated build.`);
      entries.push({ name, bytes: await readFile(directory) });
    }
    else throw new Error('Unexpected release artifact.');
  }
  for (const name of ['dist', 'web-dist']) await collect(path.join(build, name), name);
  for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/install.mjs', 'licenses']) await collect(path.join(root, name), name);
  entries.push({ name: 'CANDC_RELEASE.json', bytes: Buffer.from(JSON.stringify({ format: 1, version }) + '\n') });
  await mkdir(output, { recursive: true });
  const files = new Map([[`candc-${version}.tar.gz`, makeArchive(entries)], ['install.mjs', await readFile(path.join(root, 'scripts/install.mjs'))]]);
  const bootstrap = (await readFile(path.join(root, 'scripts/bootstrap.mjs'), 'utf8')).replaceAll('\r\n', '\n').replaceAll('__CANDC_REPOSITORY__', repo ?? '__CANDC_REPOSITORY__');
  for (const name of ['install.sh', 'install.ps1']) {
    const content = (await readFile(path.join(root, 'scripts', name), 'utf8')).replaceAll('\r\n', '\n').replace('__CANDC_BOOTSTRAP__', () => bootstrap);
    files.set(name, Buffer.from(content));
  }
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes);
  await writeFile(path.join(output, 'SHA256SUMS'), [...files].map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join('\n') + '\n');
  console.log(`Release candidate: ${output}\nNothing was published.`);
  return output;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i].slice(2);
      if (!['repo', 'build', 'output'].includes(key) || !process.argv[i + 1]) throw new Error('Usage: node scripts/package-release.mjs [--repo OWNER/REPO] [--build ISOLATED_BUILD] [--output CACHE_DIR]');
      options[key] = process.argv[i + 1];
    }
    if (!options.build) {
      await runCommand(process.execPath, ['scripts/build-isolated.mjs'], { cwd: root, timeout: 120_000 });
      options.build = path.resolve(process.env.CANDC_VERIFY_DIR ?? path.join(root, '.cache/verification'));
    }
    await packageRelease(options);
  } catch (error) { console.error(`CandC package: ${error.message}`); process.exitCode = 1; }
}
