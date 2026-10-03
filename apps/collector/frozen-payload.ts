import {cp} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export const payloadRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

/** Copy executable frozen bytes only. Distribution metadata and runtime
 * validation/digests remain the responsibility of their existing callers. */
export async function copyFrozenPayload(directory:string){
  await cp(join(payloadRoot,'dist','apps','collector'),join(directory,'dist','apps','collector'),{recursive:true});
  await cp(join(payloadRoot,'dist','packages'),join(directory,'dist','packages'),{recursive:true});
  await cp(dirname(createRequire(import.meta.url).resolve('zod/package.json')),join(directory,'node_modules','zod'),{recursive:true});
}
