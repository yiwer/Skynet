import { command } from './support.js';

// Explicit opt-in measured binaries. No paid provider, real profile or employee data.
for (const key of ['SKYNET_CLAUDE_RUNTIME', 'SKYNET_CODEX_CLI', 'SKYNET_CODEX_RUNTIME', 'SKYNET_NODE_PTY_ROOT']) {
  if (!process.env[key]) throw new Error(`Set ${key} to the measured test runtime; see docs/implementation/issue-10.md`);
}
const cases = [
  ['native-claude.test.js', 'old-session'], ['native-claude.test.js', 'code-change'],
  ['native-claude.test.js', 'subagent'], ['native-codex-cli.test.js', 'old-session'],
  ['native-materials.test.js', 'ordinary', 'codex-desktop'], ['native-materials.test.js', 'ordinary', 'codex-cli'],
];
// This additionally needs normally provisioned Windows workspace-write sandbox.
// The elevated environment used for initial evidence degrades to read-only.
if (process.env.SKYNET_NATIVE_CODEX_WRITES === '1') cases.push(['native-codex-cli.test.js', 'code-change']);
for (const [file, scenario, materialSource] of cases) {
  process.stdout.write(await command(process.execPath, ['--test', `dist/tests/${file}`], { ...process.env,
    SKYNET_NATIVE_SCENARIO: scenario, SKYNET_MATERIAL_SOURCE: materialSource, SKYNET_TEST_INSTALLER: undefined, SKYNET_TEST_PLUGINS: undefined }));
}

process.stdout.write(`Maintained synthetic native regressions complete (${cases.length}); unverified capabilities remain in the G0 matrix.\n`);
