import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Standalone Node release helpers deliberately ship without TypeScript declarations.
import { publicSourceFiles, PUBLIC_ROOT_FILES } from '../scripts/public-source.mjs';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.resolve('.cache/public-source-test-')); directories.push(directory);
  for (const file of PUBLIC_ROOT_FILES as string[]) await cp(file, path.join(directory, file));
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, 'src/example.ts'), 'export const fixture = true;\n');
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

it('exports a deterministic allowlist and excludes local histories, credentials and nested caches', async () => {
  const directory = await fixture();
  for (const child of ['.git', '.cache', '.aws', 'data', 'src/.cache']) {
    await mkdir(path.join(directory, child), { recursive: true });
    await writeFile(path.join(directory, child, 'private.json'), 'private fixture');
  }
  await writeFile(path.join(directory, '.env'), 'private fixture');
  const files: string[] = await publicSourceFiles(directory);
  expect(files).toContain('src/example.ts'); expect(files).toEqual([...files].sort());
  expect(files.some(file => file.includes('private') || file.includes('.env'))).toBe(false);
  expect(await readFile(path.join(directory, 'data/private.json'), 'utf8')).toBe('private fixture');
});

it.each(['private.key', '.env', 'history.jsonl', 'unexpected.exe', 'unexpected.png'])('refuses unexpected source artifacts: %s', async name => {
  const directory = await fixture();
  await writeFile(path.join(directory, 'src', name), 'synthetic fixture');
  await expect(publicSourceFiles(directory)).rejects.toThrow(/Private|Unexpected/);
});

it('requires review for retired design images instead of exporting them implicitly', async () => {
  const directory = await fixture();
  await mkdir(path.join(directory, 'docs/design'), { recursive: true });
  await writeFile(path.join(directory, 'docs/design/conversation-dark-concept.png'), 'retired illustration fixture');
  await expect(publicSourceFiles(directory)).rejects.toThrow('Unexpected source artifact requires review');
});

it('refuses directory junctions that could escape the source tree', async () => {
  const directory = await fixture();
  const outside = await mkdtemp(path.resolve('.cache/outside-source-')); directories.push(outside);
  await symlink(outside, path.join(directory, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(publicSourceFiles(directory)).rejects.toThrow('symlinks');
});
