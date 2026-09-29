import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConcurrencyError, ContractViolationError, DuplicateJobError } from './errors.js';
import type { JobRecord, JobRepository } from './types.js';
import { clone } from './util.js';

/** Volatile store for tests. Nothing survives the process. */
export function createInMemoryJobRepository(): JobRepository {
  const records = new Map<string, JobRecord>();
  return {
    async insert(record) {
      if (records.has(record.job.job_id)) {
        throw new DuplicateJobError('duplicate_job', `Repair job "${record.job.job_id}" already exists.`);
      }
      records.set(record.job.job_id, clone(record));
    },
    async load(job_id) {
      const found = records.get(job_id);
      return found ? clone(found) : null;
    },
    async save(record, expected_state_version) {
      const stored = records.get(record.job.job_id);
      if (!stored) {
        throw new ConcurrencyError('job_missing', `Repair job "${record.job.job_id}" no longer exists.`);
      }
      if (stored.job.state_version !== expected_state_version) {
        throw new ConcurrencyError(
          'state_version_conflict',
          `Repair job "${record.job.job_id}" is at state_version ${stored.job.state_version}, expected ${expected_state_version}.`,
        );
      }
      records.set(record.job.job_id, clone(record));
    },
    async list() {
      return [...records.values()].map((record) => clone(record));
    },
  };
}

export interface FileJobRepositoryOptions {
  /** Directory holding one JSON file per job. Created when missing. Keep it out of git. */
  directory: string;
  /** A lock older than this is treated as abandoned by a crashed writer. */
  stale_lock_ms?: number;
}

const LOCK_RETRY_MS = 15;
const LOCK_TIMEOUT_MS = 5_000;

/**
 * File-backed store for the demo and for local development. Each job is one JSON file that
 * is replaced atomically. Writes to a job are serialised with a lock file, and `save` is a
 * compare-and-swap on `state_version`, so a restarted or second worker cannot lose updates.
 */
export function createFileJobRepository(options: FileJobRepositoryOptions): JobRepository {
  const directory = options.directory;
  const staleLockMs = options.stale_lock_ms ?? 10_000;
  if (typeof directory !== 'string' || directory.trim().length === 0) {
    throw new ContractViolationError('invalid_directory', 'createFileJobRepository needs a directory.');
  }

  const fileFor = (job_id: string) => join(directory, `${encodeURIComponent(job_id)}.json`);

  async function readRecord(job_id: string): Promise<JobRecord | null> {
    try {
      return JSON.parse(await readFile(fileFor(job_id), 'utf8')) as JobRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async function writeRecord(record: JobRecord): Promise<void> {
    const target = fileFor(record.job.job_id);
    const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  async function withLock<T>(job_id: string, work: () => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true });
    const lockPath = `${fileFor(job_id)}.lock`;
    const startedAt = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(String(process.pid));
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const info = await stat(lockPath);
          if (Date.now() - info.mtimeMs > staleLockMs) await unlink(lockPath);
        } catch {
          // The holder released the lock between the two calls. Try again.
        }
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new ConcurrencyError('lock_timeout', `Could not lock repair job "${job_id}" for writing.`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
    try {
      return await work();
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }

  return {
    async insert(record) {
      await withLock(record.job.job_id, async () => {
        if (await readRecord(record.job.job_id)) {
          throw new DuplicateJobError('duplicate_job', `Repair job "${record.job.job_id}" already exists.`);
        }
        await writeRecord(record);
      });
    },
    async load(job_id) {
      return readRecord(job_id);
    },
    async save(record, expected_state_version) {
      await withLock(record.job.job_id, async () => {
        const stored = await readRecord(record.job.job_id);
        if (!stored) {
          throw new ConcurrencyError('job_missing', `Repair job "${record.job.job_id}" no longer exists.`);
        }
        if (stored.job.state_version !== expected_state_version) {
          throw new ConcurrencyError(
            'state_version_conflict',
            `Repair job "${record.job.job_id}" is at state_version ${stored.job.state_version}, expected ${expected_state_version}.`,
          );
        }
        await writeRecord(record);
      });
    },
    async list() {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      const records: JobRecord[] = [];
      for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
        records.push(JSON.parse(await readFile(join(directory, name), 'utf8')) as JobRecord);
      }
      return records;
    },
  };
}
