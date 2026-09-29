/**
 * Demo helper: removes the locally stored demo jobs so `npm run band` seeds a fresh
 * JOB-001. It touches only the local job store, never Band. Stop the crew first.
 */
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.COORDINATION_DATA_DIR ?? '.data/band';
let removed = 0;
try {
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json') && !name.endsWith('.lock')) continue;
    await unlink(join(directory, name));
    removed += 1;
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
console.log(`Removed ${removed} file(s) from ${directory}. Start the crew with "npm run band" and use a new Band room.`);
