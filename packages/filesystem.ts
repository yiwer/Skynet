import { open } from 'node:fs/promises';

export async function syncDirectory(directory: string) {
  // The production persistence contract is Linux. Windows cannot fsync directories.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
