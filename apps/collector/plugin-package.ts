import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAgentPayload } from './package.js';
import { deploymentSchema } from './installer.js';
import { serverOrigin } from './install-state.js';
import { packageEntrySchema } from './entries.js';

// The operator creates a complete local/internal marketplace. There is no
// install lifecycle script, download, public registry publish, or secret here.
export async function packPlugins(output: string, origin: string, deploymentId: string, version = '0.1.0') {
  packageEntrySchema.parse({ channel: 'npm', version });
  const directory = resolve(output);
  const deployment = deploymentSchema.parse({ deploymentId, enrollmentOrigin: serverOrigin(origin), protocolVersion: 1 });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await mkdir(directory);
  for (const host of ['codex', 'claude'] as const) {
    const plugin = join(directory, 'plugins', `skynet-${host}`);
    await cp(join(root, 'plugins', `skynet-${host}`), plugin, { recursive: true });
    const payload = join(plugin, 'payload'); await mkdir(payload);
    await writeAgentPayload(payload, deployment, version);
    for (const manifest of [host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json']) {
      const path = join(plugin, manifest); const descriptor = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...descriptor, version }, null, 2));
    }
    await writeFile(join(payload, 'entry.json'), JSON.stringify({ channel: `${host}-plugin`, version }));
  }
  const name = `skynet-${deploymentId}`;
  await mkdir(join(directory, '.agents', 'plugins'), { recursive: true });
  await mkdir(join(directory, '.claude-plugin'));
  await writeFile(join(directory, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name,
    interface: { displayName: `Skynet · ${deploymentId}` }, plugins: [{ name: 'skynet-codex',
      source: { source: 'local', path: './plugins/skynet-codex' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2));
  await writeFile(join(directory, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name, owner: { name: 'Skynet operator' },
    plugins: [{ name: 'skynet-claude', source: './plugins/skynet-claude' }] }, null, 2));
  await writeFile(join(directory, 'README.md'), `# Skynet internal marketplace\n\nRequires Node 24 and a supported native Agent. Copy this entire directory to the company distribution location before employees add it. No npm install or package install scripts are needed.\n\nCodex CLI 0.157.1: \`codex plugin marketplace add "<catalog-directory>" --json\`, then \`codex plugin add skynet-codex@${name} --json\`.\n\nClaude Code 2.1.281: \`claude plugin marketplace add "<catalog-directory>" --scope user\`, then \`claude plugin install skynet-claude@${name} --scope user --json\`.\n\nRun the installed plugin's skynet-setup navigation or use its bundled scripts/skynet.cjs in a local terminal. Set only SKYNET_KEY and run \`node "<installed-plugin>/scripts/skynet.cjs" setup\`. Then clear SKYNET_KEY and complete ordinary host trust. The deterministic setup installs stable user hooks and a shared background; plugin skills never report work.\n\nThe installed payload is copied outside the plugin cache before collection begins. One device/runtime/queue is shared with npm and the other plugin. Only local/internal marketplace channels are measured; public catalog listing, Desktop UI installation and no-Node packages are not claimed.\n\nTo remove one entry, first run \`node "<installed-plugin>/scripts/skynet.cjs" entry-remove --entry <codex-plugin|claude-plugin>\`, then the host's normal plugin remove/uninstall command. If the cache was already removed, use the stable skynet-launcher.mjs shown by status. A marketplace-only removal has no dependable uninstall callback and leaves the registered capture active until entry-remove; full uninstall is a separate operation.\n`);
  return { directory, marketplace: name, version, prerequisites: ['Node 24', 'installed native Agent', 'ordinary hook/workspace trust'], deployment };
}
