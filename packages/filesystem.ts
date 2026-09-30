import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export async function atomicJson(path: string, value: unknown) {
  await atomicText(path, JSON.stringify(value));
}
export async function atomicText(path: string, value: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(() => undefined); }
}

export async function syncDirectory(directory: string) {
  // The production persistence contract is Linux. Windows cannot fsync directories.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
