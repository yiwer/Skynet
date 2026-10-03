import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandbox, syntheticSession } from './support.js';

const sandbox = await createSandbox();
try {
  const employee = await sandbox.provision('合成演示员工');
  const reader = await sandbox.provision('合成演示读者');
  const origin = await sandbox.startServer();
  const root = join(sandbox.directory, 'native-sessions');
  const state = join(sandbox.directory, 'collector');
  const session = await syntheticSession(root);
  await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
    nativeRoot: root, sourceVersion: 'synthetic-fixture-1', sourceOs: process.platform });
  await sandbox.collectorCommand('hook', state, session.event);
  await sandbox.startCollector(state);
  const credentialsFile = join(sandbox.directory, 'demo-reader.json');
  await writeFile(credentialsFile, JSON.stringify({ origin, readerCredential: reader.readerCredential }), { mode: 0o600 });
  console.log(`Synthetic demo: ${origin}\nGenerated reader credential: ${credentialsFile}\nNo real Desktop host acceptance is implied. Ctrl+C stops the server and isolated PostgreSQL container.`);
  await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally { await sandbox.close(); }
