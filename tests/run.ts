import { ownedCommand,OwnedCommandError } from './owned-command.js';
import { readdir } from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Keep the bounded failing suite's actual reporter output and nonzero result. */
export async function runTests(files:string[],env:NodeJS.ProcessEnv=process.env){
  const shard=env.SKYNET_TEST_SHARD;
  if(shard!==undefined&&!['1/2','2/2','1/4','2/4','3/4','4/4'].includes(shard))throw new Error('SKYNET_TEST_SHARD must be 1/2 or 2/2, or 1/4 through 4/4; omit it for the complete suite');
  // Each CI job has one active test file; fixtures retain their owned databases.
  // Sharding is not inherited by nested fixtures that invoke this entrypoint.
  try{const result=await ownedCommand(process.execPath,['--import','tsx','--test','--test-concurrency=1',...(shard?[`--test-shard=${shard}`]:[]),...files],
    {...env,SKYNET_TEST_SHARD:undefined},'',{timeoutMs:20*60*1000,maxOutputBytes:16*1024*1024});
    process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  }catch(error){
    if(!(error instanceof OwnedCommandError))throw error;
    process.stdout.write(error.stdout);process.stderr.write(error.message+'\n');process.exitCode=1;
  }
}

// Tests create their own isolated PostgreSQL container. No user DATABASE_URL is consumed.
// native-* host tests opt in separately. Some ordinary public Web/MCP journeys
// use the explicitly configured Claude CLI against their own loopback provider.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts') && !file.startsWith('native-')).sort().map(file => `tests/${file}`);
  await runTests(files);
}
