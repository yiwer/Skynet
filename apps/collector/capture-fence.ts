import { join } from 'node:path';
import { jsonFile, optionalJson, type Installation } from './install-state.js';

// A durable source settings file proves that this source was connected before.
// Legacy routing must not be restarted for that source after it is disabled,
// even when another Codex source still has an active owner. Never-configured
// Desktop remains an unverified source, not an invented capability requirement.
export async function assertCaptureFences(state: string, installation: Installation) {
  if ((await jsonFile(join(installation.runtime, 'package.json'))).captureFenceVersion === 1) return;
  for (const client of installation.clients.filter(client => client.source !== 'claude-code-cli' && !client.configured)) {
    if (await optionalJson(join(state, 'sources', client.source, 'settings.json')))
      throw new Error(`Previous release cannot enforce the current Codex capture fence for ${client.source}; current entries and evidence retained. Upgrade or use current maintenance drain. No writer was started.`);
  }
}
