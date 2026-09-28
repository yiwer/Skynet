import { command } from './support.js';

// Tests create their own isolated PostgreSQL container. No user DATABASE_URL is consumed.
process.stdout.write(await command(process.execPath, ['--import', 'tsx', '--test', 'tests/archive.test.ts', 'tests/recovery.test.ts', 'tests/codex-cli.test.ts'], process.env));
