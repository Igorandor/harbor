import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { ApiError } from './upstream.js';
import { z } from 'zod';

const storedTimestamp = z.iso.datetime();

export type WorkspaceIdentity = { owner: string; instance: string };
export type StoredDocument = WorkspaceIdentity & {
  version: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type StoreListing<T> = { records: T[]; unreadable: string[]; total: number };

/** Atomic files for a single gateway writer. Native credentials never enter this store. */
export class WorkspaceStore {
  private locks = new Set<string>();
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private directory(actor: WorkspaceIdentity, collection: string) {
    if (!/^[a-z][a-z-]{1,40}$/.test(collection)) throw new ApiError(400, 'Invalid collection.');
    const scope = createHash('sha256')
      .update(actor.instance + '\0' + actor.owner)
      .digest('hex');
    return join(this.root, collection, scope);
  }
  private path(actor: WorkspaceIdentity, collection: string, id: string) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw new ApiError(400, 'Invalid record identifier.');
    return join(this.directory(actor, collection), id + '.json');
  }
  async exclusive<T>(
    actor: WorkspaceIdentity,
    collection: string,
    id: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([actor.instance, actor.owner, collection, id]);
    if (this.locks.has(key))
      throw new ApiError(409, 'This record is being updated. Refresh before retrying.');
    this.locks.add(key);
    try {
      return await task();
    } finally {
      this.locks.delete(key);
    }
  }
  async read<T extends StoredDocument>(
    actor: WorkspaceIdentity,
    collection: string,
    id: string,
  ): Promise<T> {
    const path = this.path(actor, collection, id);
    try {
      const initial = await lstat(path);
      if (!initial.isFile() || initial.isSymbolicLink() || initial.size > 4_000_000)
        throw new Error('Invalid record file');
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let data: Buffer;
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.ino !== initial.ino ||
          (process.platform !== 'win32' && opened.dev !== initial.dev)
        )
          throw new Error('Record file was replaced');
        // Windows lstat reports dev=0 while fstat reports the volume; recheck the
        // directory entry because that platform has no O_NOFOLLOW constant.
        const current = await lstat(path);
        if (!current.isFile() || current.isSymbolicLink() || current.ino !== opened.ino)
          throw new Error('Record file was replaced');
        // Bound the actual descriptor read, including a file growing after lstat.
        const buffer = Buffer.alloc(4_000_001);
        let length = 0;
        while (length < buffer.length) {
          const read = await handle.read(buffer, length, buffer.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > 4_000_000) throw new Error('Oversized record');
        data = buffer.subarray(0, length);
      } finally {
        await handle.close();
      }
      const value = JSON.parse(data.toString('utf8')) as T;
      if (
        value.version !== 1 ||
        value.id !== id ||
        value.owner !== actor.owner ||
        value.instance !== actor.instance ||
        !storedTimestamp.safeParse(value.createdAt).success ||
        !storedTimestamp.safeParse(value.updatedAt).success ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 1
      )
        throw new Error('Invalid record');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ApiError(404, 'Record not found for this account and instance.');
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        'Stored data could not be read. Preserve the data directory and inspect this record before continuing.',
      );
    }
  }
  async write<T extends StoredDocument>(
    record: T,
    collection: string,
    expected?: number,
  ): Promise<T> {
    const target = this.path(record, collection, record.id);
    if (expected !== undefined) {
      const existing = await this.read(record, collection, record.id);
      if (existing.revision !== expected)
        throw new ApiError(409, 'This record changed. Refresh to review the latest version.');
    }
    const text = JSON.stringify(record);
    if (Buffer.byteLength(text, 'utf8') > 4_000_000)
      throw new ApiError(
        413,
        'This record reached its 4 MB storage limit. Export and start a new record.',
      );
    let temporary: string | undefined;
    try {
      await mkdir(this.directory(record, collection), { recursive: true, mode: 0o700 });
      temporary = target + '.' + randomUUID() + '.tmp';
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      return record;
    } catch (error) {
      if (temporary) await unlink(temporary).catch(() => {});
      throw new ApiError(
        507,
        'The record could not be saved. Check available disk space and directory permissions. No pending operation should be retried without checking its result.',
      );
    }
  }
  private async names(actor: WorkspaceIdentity, collection: string): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.directory(actor, collection));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ApiError(500, 'The stored record list could not be read.');
    }
    const names = files.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name));
    if (names.length > 1000)
      throw new ApiError(
        409,
        'The data directory contains more than 1,000 records. Archive it through the documented retention procedure.',
      );
    return names;
  }
  async scan<T extends StoredDocument, R extends { updatedAt: string }>(
    actor: WorkspaceIdentity,
    collection: string,
    project: (record: T) => Promise<R | undefined> | R | undefined,
  ): Promise<StoreListing<R>> {
    const names = await this.names(actor, collection);
    const records: R[] = [],
      unreadable: string[] = [];
    for (const name of names) {
      let record: T;
      try {
        record = await this.read<T>(actor, collection, name.slice(0, -5));
      } catch {
        unreadable.push(name.slice(0, -5));
        continue;
      }
      try {
        const summary = await project(record);
        if (summary) records.push(summary);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        unreadable.push(name.slice(0, -5));
      }
    }
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { records, unreadable, total: names.length };
  }
  async create<T extends Omit<StoredDocument, 'id' | 'revision' | 'createdAt' | 'updatedAt'>>(
    actor: WorkspaceIdentity,
    collection: string,
    value: T,
  ): Promise<T & StoredDocument> {
    return this.exclusive(actor, collection, 'create', async () => {
      const existing = await this.names(actor, collection);
      if (existing.length >= 500)
        throw new ApiError(
          409,
          'This account reached 500 stored records in this collection. Export and follow the retention instructions.',
        );
      const now = new Date().toISOString();
      const record = {
        ...value,
        owner: actor.owner,
        instance: actor.instance,
        version: 1 as const,
        id: randomUUID(),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      return this.write(record, collection);
    });
  }
}
