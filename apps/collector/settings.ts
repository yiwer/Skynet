import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Installed adapters contain no credential copies. A single private identity is
// shared by every source in the same OS execution environment.
export async function readCollectorSettings(state: string) {
  const adapter = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
  if (adapter.sharedIdentity !== undefined) {
    if (adapter.sharedIdentity !== '../../identity.json') throw new Error('Invalid shared identity reference');
    const identity = JSON.parse(await readFile(resolve(state, adapter.sharedIdentity), 'utf8'));
    return { ...adapter, server: identity.server, deviceId: identity.deviceId,
      deviceCredential: identity.deviceCredential, enrolledAt: identity.enrolledAt };
  }
  return adapter;
}
