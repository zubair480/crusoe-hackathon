import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaseState } from './model';
import { initialInspection } from './demo-ports';

export function seed(): CaseState {
  return { revision: 0, inspection: initialInspection(), recommendation: null, job: null, completion: null, verification: null, scenarioLoaded: false, schedule: { fingerprint: null, rows: [] }, events: [{ id: randomUUID(), at: new Date().toISOString(), title: 'Inspection received', detail: 'Fictional inspection note loaded. Radiometric images and calibrated measurements are missing.', mode: 'simulated' }] };
}
export class CaseStore {
  constructor(readonly directory: string) {}
  async read(): Promise<CaseState> {
    try { return JSON.parse(await readFile(join(this.directory, 'case.json'), 'utf8')) as CaseState; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return seed(); throw error; }
  }
  async update<T>(operation: (state: CaseState) => Promise<{ state: CaseState; result: T }>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = join(this.directory, 'case.lock');
    let lock;
    for (let retry = 0; retry < 75; retry++) {
      try { lock = await open(lockPath, 'wx'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await new Promise(r => setTimeout(r, 40)); }
    }
    if (!lock) throw new Error('Case is busy; retry in a moment.');
    const temporary = join(this.directory, `case-${randomUUID()}.tmp`);
    try {
      const output = await operation(await this.read());
      await writeFile(temporary, JSON.stringify(output.state, null, 2), 'utf8');
      await rename(temporary, join(this.directory, 'case.json'));
      return output.result;
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(lockPath);
    }
  }
}
