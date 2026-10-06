import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { checkNode, parseOptions, validPort, withLock, npmCommand, startServer, stopServer } from './install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (options.help || !command) console.log('Source launcher: node scripts/launcher.mjs start [--no-browser] | stop\nStart installs dependencies if needed and rebuilds source outputs.');
  else {
    checkNode();
    const port = validPort(options.port ?? process.env.CANDC_PORT ?? 4317);
    if (command === 'stop') await withLock(root, () => stopServer(root, { port, source: true }));
    else if (command === 'start') await withLock(root, () => startServer(root, root, { port, source: true, noBrowser: Boolean(options['no-browser']),
      prepare: async () => {
        try { await access(path.join(root, 'node_modules')); }
        catch { await npmCommand(['ci', '--ignore-scripts'], { cwd: root, timeout: 180_000 }); }
        await npmCommand(['run', 'build'], { cwd: root });
      } }));
    else throw new Error('Unknown source launcher command. Use --help.');
  }
} catch (error) { console.error(`CandC: ${error.message}`); process.exitCode = 1; }
