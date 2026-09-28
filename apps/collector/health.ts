import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../../packages/filesystem.js';
import type { DeliveryHealth } from '../../packages/contracts/delivery.js';
import type { Source } from '../../packages/contracts/archive.js';

export async function reportDeliveryHealth(state: string, settings: { server: string; deviceCredential: string; deviceId: string; source: Source }, delivery: DeliveryHealth) {
  const path = join(state, 'delivery-health.json');
  let previous: { checkedAt?: string; fingerprint?: string; failed?: boolean; lastSuccessAt?: string | null } = {};
  try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { /* First report or unavailable local diagnostic. */ }
  const fingerprint = createHash('sha256').update(JSON.stringify(delivery)).digest('hex');
  const elapsed = Date.now() - Date.parse(previous.checkedAt ?? '1970-01-01');
  // Do not hammer an unreachable or rejecting endpoint from the status path.
  const deliveryRecovered = delivery.lastSuccessAt && delivery.lastSuccessAt !== previous.lastSuccessAt;
  if (elapsed < 30_000 && !deliveryRecovered && (previous.failed || previous.fingerprint === fingerprint)) return;
  const nonce = randomUUID(); let failed = false;
  try {
    const response = await fetch(new URL('/api/devices/health', settings.server), { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${settings.deviceCredential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce, source: settings.source, delivery }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Health rejected');
    const ack = await response.json(); if (ack.nonce !== nonce || ack.deviceId !== settings.deviceId) throw new Error('Health identity mismatch');
  } catch { failed = true; }
  await atomicJson(path, { checkedAt: new Date().toISOString(), fingerprint, failed, lastSuccessAt: delivery.lastSuccessAt });
}
