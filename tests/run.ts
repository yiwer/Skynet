import { command } from './support.js';
import { readdir } from 'node:fs/promises';

// Tests create their own isolated PostgreSQL container. No user DATABASE_URL is consumed.
// Installed-runtime tests opt in separately; CI must not assume a native client exists.
const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts') && !file.startsWith('native-')).sort().map(file => `tests/${file}`);
process.stdout.write(await command(process.execPath, ['--import', 'tsx', '--test', ...files], process.env));
