import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './database.js';
import { syncDirectory } from '../../packages/filesystem.js';

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
    const bytes = await readFile(join(this.root, device, hash));
    if (digest(bytes) !== hash) throw new Error('Stored artifact integrity failure');
    return bytes;
  }
}
