import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('private distribution and frozen runtime load independently with their own metadata',async()=>{
  const {writeAgentPayload}=await import(pathToFileURL(resolve('dist/apps/collector/package.js')).href);
  const {stageRuntime,checkRuntime,runtimeDigest}=await import(pathToFileURL(resolve('dist/apps/collector/release.js')).href);
  const directory=await mkdtemp(join(tmpdir(),'skynet-frozen-payload-'));
  const distribution=join(directory,'distribution');const deployment={deploymentId:'synthetic-payload-review',enrollmentOrigin:'https://synthetic.invalid',protocolVersion:1 as const};
  await writeAgentPayload(distribution,deployment,'0.1.5');
  await checkRuntime(distribution,process.execPath);
  const metadata=JSON.parse(await readFile(join(distribution,'package.json'),'utf8'));
  assert.equal(metadata.name,'@skynet/agent');assert.equal(metadata.private,true);assert.equal(metadata.version,'0.1.5');
  assert.equal(metadata.bin.skynet,'dist/apps/collector/cli.js');assert.deepEqual(metadata.bundledDependencies,['zod']);
  assert.deepEqual(JSON.parse(await readFile(join(distribution,'deployment.json'),'utf8')),deployment);
  const staged=await stageRuntime(join(directory,'state'),'0.1.6');
  assert.equal(staged.digest,await runtimeDigest(staged.runtime));
  assert.deepEqual(JSON.parse(await readFile(join(staged.runtime,'package.json'),'utf8')),{type:'module',version:'0.1.6',captureFenceVersion:1});
  for(const file of ['dist/apps/collector/cli.js','dist/apps/collector/hook.js','dist/packages/filesystem.js','node_modules/zod/package.json'])
    assert.deepEqual(await readFile(join(distribution,file)),await readFile(join(staged.runtime,file)));
  console.log(`Owned frozen payload fixture retained: ${directory}; no setup, Task, daemon, transcript or provider.`);
});
