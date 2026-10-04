import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { digest } from '../server/database.js';

export const PROMPT_VERSION = 'original-segments-insights-2';
export const QWEN_ORIGIN = 'https://maas.qianwenaiapi.com/apps/anthropic';
export const QODER_CN_ORIGIN = 'https://qoder.cn';
const absolute = z.string().min(1).refine(isAbsolute, 'Use an absolute analysis-only path');
const schema = z.object({
  mode: z.enum(['qwen-payg', 'fixture', 'qoder-cn']), executable: absolute, runtimeVersion: z.enum(['2.1.281','1.1.64']), model: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/),
  sdkVersion: z.literal('1.0.50').optional(), requestBudget: z.number().int().positive().max(1_000_000_000).optional(), requireFreeModel: z.boolean().optional(),
  workDirectory: absolute, credentialFile: absolute.optional(), fixtureOrigin: z.url().optional(), gitBashPath: absolute.optional(),
  budgetId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), budgetCny: z.number().nonnegative().max(1_000_000),
  inputCnyPerMillion: z.number().nonnegative().max(10_000), outputCnyPerMillion: z.number().nonnegative().max(10_000),
  // Deployment must verify a conservative ceiling including cache creation and hidden tokens.
  pricingEvidence: z.string().min(1).max(1024).optional(), pricingVerifiedAt: z.iso.datetime().optional(),
  inputTokensPerByteUpperBound: z.number().min(1).max(16).default(1),
  maxInputBytes: z.number().int().min(1024).max(131_072).default(65_536),
  maxSessionBytes: z.number().int().min(1024).max(8_388_608).default(1_048_576),
  maxSegments: z.number().int().min(1).max(16).default(4),
  maxRequests: z.number().int().min(1).max(32).default(3), maxOutputTokens: z.number().int().min(512).max(8192).default(4096),
  maxRequestBytes: z.number().int().min(32_768).max(1_048_576).default(262_144),
  timeoutSeconds: z.number().int().min(5).max(300).default(90),
  maxAttempts: z.number().int().min(1).max(3).default(2), concurrency: z.number().int().min(1).max(4).default(1),
  leaseSeconds: z.number().int().min(5).max(30).default(10), retryDelaySeconds: z.number().int().min(1).max(30).default(3),
  autoAnalyzeUpdates: z.boolean().default(true), autoDebounceSeconds: z.number().int().min(1).max(60).default(3),
}).strict();
export type AnalysisConfig = z.infer<typeof schema> & { origin: string; reservationCny: number; reservationRequests?:number; configurationHash: string; credentialFingerprint: string | null };
export function dedicatedPaygKey(value: string) {
  // Explicit dedicated file only. Current and earlier generic PAYG key formats; never Token Plan or Anthropic credentials.
  return /^sk-(?:ws-)?[A-Za-z0-9_-]+$/.test(value) && !/^sk-(?:sp|ant)-/.test(value);
}
export async function readCredential(config: AnalysisConfig) {
  if (!config.credentialFile || (await stat(config.credentialFile)).size > 4096) throw new Error('Dedicated credential file required');
  const bytes = await readFile(config.credentialFile);
  if (digest(bytes) !== config.credentialFingerprint || !(config.mode==='qoder-cn'?/^pt-[A-Za-z0-9._~-]+$/.test(bytes.toString('utf8').trim()):dedicatedPaygKey(bytes.toString('utf8').trim()))) throw new Error('Credential changed or invalid');
  return bytes.toString('utf8').trim();
}
export async function readAnalysisConfig(path: string): Promise<AnalysisConfig> {
  if ((await stat(path)).size > 16384) throw new Error('Analysis configuration exceeds limit');
  const config = schema.parse(JSON.parse(await readFile(path, 'utf8')));
  let origin = QWEN_ORIGIN;
  if(config.mode==='qoder-cn'){
    if(config.runtimeVersion!=='1.1.64'||config.sdkVersion!=='1.0.50'||!config.credentialFile||config.fixtureOrigin||!config.requestBudget||
      config.budgetCny!==0||config.inputCnyPerMillion!==0||config.outputCnyPerMillion!==0)throw new Error('Qoder CN requires its dedicated PAT, fixed CLI/SDK, request budget and no monetary conversion');
    origin=QODER_CN_ORIGIN;config.requireFreeModel??=true;
    if(config.maxRequests>config.requestBudget)throw new Error('Request budget cannot reserve one bounded analysis');
  }else if(config.runtimeVersion!=='2.1.281'||config.sdkVersion!==undefined||config.requestBudget!==undefined||config.requireFreeModel!==undefined){
    throw new Error('Qoder settings require Qoder CN mode');
  }
  if (config.mode === 'fixture') {
    const url = new URL(config.fixtureOrigin ?? '');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash
      || config.credentialFile || config.budgetCny !== 0 || config.inputCnyPerMillion !== 0 || config.outputCnyPerMillion !== 0) throw new Error('Invalid loopback fixture configuration');
    origin = url.origin;
  } else if (config.mode==='qwen-payg'&&(!config.credentialFile || config.fixtureOrigin || config.budgetCny <= 0 || config.inputCnyPerMillion <= 0 || config.outputCnyPerMillion <= 0
    || !config.pricingEvidence || !config.pricingVerifiedAt)) {
    throw new Error('PAYG requires its own credential, model, current pricing and explicit positive budget');
  }
  // Reserve from the operator-verified text-token/byte and pricing ceilings, including cache
  // creation/hidden-output charges. No byte-to-billed-token assumption is certified by fixtures.
  if (config.mode !== 'fixture' && (await stat(config.credentialFile!)).size > 4096) throw new Error('Credential file exceeds limit');
  const credentialFingerprint = config.mode !== 'fixture' ? digest(await readFile(config.credentialFile!)) : null;
  if(config.mode==='qoder-cn')await readCredential({...config,origin,reservationCny:0,configurationHash:'',credentialFingerprint});
  const reservationCny = Math.ceil(config.maxRequests * (config.maxRequestBytes * config.inputTokensPerByteUpperBound * config.inputCnyPerMillion
    + config.maxOutputTokens * config.outputCnyPerMillion) / 1_000_000 * 1_000_000) / 1_000_000;
  if (reservationCny > config.budgetCny) throw new Error('Budget cannot reserve one bounded analysis');
  return { ...config, origin, reservationCny, ...(config.mode==='qoder-cn'?{reservationRequests:config.maxRequests}:{}), credentialFingerprint,
    configurationHash: digest(JSON.stringify({ ...config, origin, credentialFingerprint, promptVersion: PROMPT_VERSION })) };
}
export function publicConfig(config: AnalysisConfig) {
  const { mode, model, runtimeVersion, maxInputBytes, maxSessionBytes, maxSegments, maxRequests, maxOutputTokens, timeoutSeconds, reservationCny, budgetCny, budgetId, configurationHash,
    maxAttempts, concurrency, leaseSeconds, retryDelaySeconds, autoAnalyzeUpdates, autoDebounceSeconds } = config;
  return { mode, model, runtimeVersion, maxInputBytes, maxSessionBytes, maxSegments, maxRequests, maxOutputTokens, timeoutSeconds, reservationCny, budgetCny, budgetId, configurationHash, promptVersion: PROMPT_VERSION,
    maxAttempts, concurrency, leaseSeconds, retryDelaySeconds, autoAnalyzeUpdates, autoDebounceSeconds,
    ...(mode==='qoder-cn'?{sdkVersion:config.sdkVersion,requestBudget:config.requestBudget,reservationRequests:config.reservationRequests,requireFreeModel:config.requireFreeModel}:{}) };
}
