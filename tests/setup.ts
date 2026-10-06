import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Every test owns a child directory; a clean checkout need not have a cache yet.
await mkdir(path.resolve('.cache'), { recursive: true });
