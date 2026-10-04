import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpSandbox } from './mcp-support.js';

test('adding employees while the platform serves readers preserves every issued account', { timeout: 90000 }, async () => {
  const sandbox = await mcpSandbox();
  try {
    const first = await sandbox.provision('Initial owner');
    for (let wave = 0; wave < 3; wave++) {
      const readers = (async () => {
        for (let i = 0; i < 25; i++) {
          const response = await sandbox.api('/api/sessions', first.readerCredential);
          assert.equal(response.status, 200);
        }
      })();
      const created = await Promise.all(Array.from({ length: 8 }, (_, index) => sandbox.provision(`Wave ${wave} employee ${index}`)));
      await readers;
      for (const account of created) {
        const response = await sandbox.api('/api/me', account.readerCredential);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).id, account.employeeId);
      }
    }
    await sandbox.restart();
    assert.equal((await sandbox.api('/api/me', first.readerCredential)).status, 200);
  } finally { await sandbox.close(); }
});
