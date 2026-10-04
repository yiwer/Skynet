import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './database.js';
import { syncDirectory } from '../../packages/filesystem.js';

export class RawUnavailableError extends Error {
  constructor(readonly device: string, readonly hash: string, readonly reason: 'missing'|'unreadable'|'hash-mismatch', options?: ErrorOptions) {
    super('Stored original unavailable: '+reason, options); this.name = 'RawUnavailableError';
  }
}

export class RawStore {
  constructor(private root: string) {}
  async write(device: string, hash: string, bytes: Buffer) {
    if (digest(bytes) !== hash) throw new Error('Artifact hash mismatch');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = join(this.root, device);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncDirectory(this.root);
    const target = join(directory, hash);
    const temporary = join(directory, `.pending-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const stored = await readFile(target);
        if (digest(stored) !== hash) throw new Error('Stored artifact integrity failure');
      }
      await syncDirectory(directory);
    } finally { await unlink(temporary); }
  }
  async read(device: string, hash: string) {
    let bytes: Buffer;
    try { bytes = await readFile(join(this.root, device, hash)); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['ENOENT','ENOTDIR','EACCES','EPERM','EIO','EISDIR','EMFILE','ENFILE','EBUSY'].includes(code ?? '')) throw error;
      throw new RawUnavailableError(device, hash, code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', { cause: error });
    }
    if (digest(bytes) !== hash) throw new RawUnavailableError(device, hash, 'hash-mismatch');
    return bytes;
  }
}
