import {createHash} from 'node:crypto';
import {mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

// Official 1.1.64 channel manifest, 2026-10-04. Baseline supports x64 hosts
// without AVX2. SDK 1.0.50 declares this exact compatible native version.
const url='https://static.qoder.com.cn/qoder-cli-cn/releases/1.1.64/qoderclicn-linux-x64-baseline.tar.gz';
const sha256='2f44f16cb57384ce23bbc8281413e8ae923a576ba2b88ac94f65dc971736a7ac';
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Pinned Qoder deployment currently requires Linux x64');
const directory=resolve(process.argv[2]??'/opt/qodercn');
await mkdir(directory,{mode:0o755}); // Refuse overwriting an existing runtime.
const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(180000)});
if(!response.ok||!response.body)throw new Error('Qoder runtime download failed');
const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>134217728)throw new Error('Qoder archive exceeds download limit');chunks.push(chunk);}
const archive=Buffer.concat(chunks);if(createHash('sha256').update(archive).digest('hex')!==sha256)throw new Error('Qoder runtime checksum mismatch');
const archivePath=join(directory,'runtime.tar.gz');await writeFile(archivePath,archive,{flag:'wx'});
const members=execFileSync('tar',['-tzf',archivePath],{encoding:'utf8',maxBuffer:1048576}).trim().split('\n');
if(members.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw new Error('Qoder runtime archive path invalid');
execFileSync('tar',['-xzf',archivePath,'--no-same-owner','-C',directory]);
const executable=join(directory,'qoderclicn');await chmod(executable,0o755);
if(execFileSync(executable,['--version'],{encoding:'utf8',timeout:10000}).trim()!=='1.1.64')throw new Error('Qoder runtime version mismatch');
await rm(archivePath);console.log('Installed verified Qoder CN 1.1.64');
