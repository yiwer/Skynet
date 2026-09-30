import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { digest } from '../server/database.js';

export const PROMPT_VERSION = 'short-session-2';
export const QWEN_ORIGIN = 'https://maas.qianwenaiapi.com/apps/anthropic';
const absolute = z.string().min(1).refine(isAbsolute, 'Use an absolute analysis-only path');
const schema = z.object({
  mode: z.enum(['qwen-payg', 'fixture']), executable: absolute, runtimeVersion: z.literal('2.1.281'), model: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/),
  workDirectory: absolute, credentialFile: absolute.optional(), fixtureOrigin: z.url().optional(), gitBashPath: absolute.optional(),
  budgetId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), budgetCny: z.number().nonnegative().max(1_000_000),
  inputCnyPerMillion: z.number().nonnegative().max(10_000), outputCnyPerMillion: z.number().nonnegative().max(10_000),
  // Deployment must verify a conservative ceiling including cache creation and hidden tokens.
  pricingEvidence: z.string().min(1).max(1024).optional(), pricingVerifiedAt: z.iso.datetime().optional(),
  inputTokensPerByteUpperBound: z.number().min(1).max(16).default(1),
  maxInputBytes: z.number().int().min(1024).max(131_072).default(65_536),
  maxRequests: z.number().int().min(1).max(5).default(3), maxOutputTokens: z.number().int().min(512).max(8192).default(4096),
  maxRequestBytes: z.number().int().min(32_768).max(1_048_576).default(262_144),
  timeoutSeconds: z.number().int().min(5).max(300).default(90),
  maxAttempts: z.number().int().min(1).max(3).default(2), concurrency: z.number().int().min(1).max(4).default(1),
  leaseSeconds: z.number().int().min(5).max(30).default(10), retryDelaySeconds: z.number().int().min(1).max(30).default(3),
  autoAnalyzeUpdates: z.boolean().default(true), autoDebounceSeconds: z.number().int().min(1).max(60).default(3),
}).strict();
export type AnalysisConfig = z.infer<typeof schema> & { origin: string; reservationCny: number; configurationHash: string; credentialFingerprint: string | null };
export function dedicatedPaygKey(value: string) {
  // Explicit dedicated file only. Current and earlier generic PAYG key formats; never Token Plan or Anthropic credentials.
  return /^sk-(?:ws-)?[A-Za-z0-9_-]+$/.test(value) && !/^sk-(?:sp|ant)-/.test(value);
}
export async function readCredential(config: AnalysisConfig) {
  if (!config.credentialFile || (await stat(config.credentialFile)).size > 4096) throw new Error('Dedicated credential file required');
  const bytes = await readFile(config.credentialFile);
  if (digest(bytes) !== config.credentialFingerprint || !dedicatedPaygKey(bytes.toString('utf8').trim())) throw new Error('Credential changed or invalid');
  return bytes.toString('utf8').trim();
}
export async function readAnalysisConfig(path: string): Promise<AnalysisConfig> {
  if ((await stat(path)).size > 16384) throw new Error('Analysis configuration exceeds limit');
  const config = schema.parse(JSON.parse(await readFile(path, 'utf8')));
  let origin = QWEN_ORIGIN;
  if (config.mode === 'fixture') {
    const url = new URL(config.fixtureOrigin ?? '');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash
      || config.credentialFile || config.budgetCny !== 0 || config.inputCnyPerMillion !== 0 || config.outputCnyPerMillion !== 0) throw new Error('Invalid loopback fixture configuration');
    origin = url.origin;
  } else if (!config.credentialFile || config.fixtureOrigin || config.budgetCny <= 0 || config.inputCnyPerMillion <= 0 || config.outputCnyPerMillion <= 0
    || !config.pricingEvidence || !config.pricingVerifiedAt) {
    throw new Error('PAYG requires its own credential, model, current pricing and explicit positive budget');
  }
  // Reserve from the operator-verified text-token/byte and pricing ceilings, including cache
  // creation/hidden-output charges. No byte-to-billed-token assumption is certified by fixtures.
  if (config.mode === 'qwen-payg' && (await stat(config.credentialFile!)).size > 4096) throw new Error('Credential file exceeds limit');
  const credentialFingerprint = config.mode === 'qwen-payg' ? digest(await readFile(config.credentialFile!)) : null;
  const reservationCny = Math.ceil(config.maxRequests * (config.maxRequestBytes * config.inputTokensPerByteUpperBound * config.inputCnyPerMillion
    + config.maxOutputTokens * config.outputCnyPerMillion) / 1_000_000 * 1_000_000) / 1_000_000;
  if (reservationCny > config.budgetCny) throw new Error('Budget cannot reserve one bounded analysis');
  return { ...config, origin, reservationCny, credentialFingerprint,
    configurationHash: digest(JSON.stringify({ ...config, origin, credentialFingerprint, promptVersion: PROMPT_VERSION })) };
}
export function publicConfig(config: AnalysisConfig) {
  const { mode, model, runtimeVersion, maxInputBytes, maxRequests, maxOutputTokens, timeoutSeconds, reservationCny, budgetCny, configurationHash,
    maxAttempts, concurrency, leaseSeconds, retryDelaySeconds, autoAnalyzeUpdates, autoDebounceSeconds } = config;
  return { mode, model, runtimeVersion, maxInputBytes, maxRequests, maxOutputTokens, timeoutSeconds, reservationCny, budgetCny, configurationHash, promptVersion: PROMPT_VERSION,
    maxAttempts, concurrency, leaseSeconds, retryDelaySeconds, autoAnalyzeUpdates, autoDebounceSeconds };
}
