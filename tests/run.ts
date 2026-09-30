import { ownedCommand,OwnedCommandError } from './owned-command.js';
import { readdir } from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Keep the bounded failing suite's actual reporter output and nonzero result. */
export async function runTests(files:string[],env:NodeJS.ProcessEnv=process.env){
  try{const result=await ownedCommand(process.execPath,['--import','tsx','--test',...files],env,'',{timeoutMs:20*60*1000,maxOutputBytes:16*1024*1024});
    process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  }catch(error){
    if(!(error instanceof OwnedCommandError))throw error;
    process.stdout.write(error.stdout);process.stderr.write(error.message+'\n');process.exitCode=1;
  }
}

// Tests create their own isolated PostgreSQL container. No user DATABASE_URL is consumed.
// Installed-runtime tests opt in separately; CI must not assume a native client exists.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts') && !file.startsWith('native-')).sort().map(file => `tests/${file}`);
  await runTests(files);
}
