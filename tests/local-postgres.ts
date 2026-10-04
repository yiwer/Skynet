import { createServer } from 'node:net';
import { join, resolve, isAbsolute } from 'node:path';
import { writeFile, readFile, unlink, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { ownedCommand } from './owned-command.js';

/** Explicit portable PostgreSQL adapter for hosts without Docker. Each run owns a fresh cluster. */
export async function localPostgres(directory: string, password: string, database: string, binaries: string, stoppedSnapshot?:string) {
  if (!isAbsolute(binaries)) throw new Error('SKYNET_TEST_POSTGRES_BIN must be an absolute binary directory');
  const binary = (name: string) => join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
  const data = resolve(directory, 'postgres');
  const marker = join(directory, 'postgres-owner');
  const owner = randomUUID();
  await writeFile(marker, owner, { flag: 'wx' });
  const passwordFile = join(directory, 'postgres-password');
  await writeFile(passwordFile, password, { flag: 'wx', mode: 0o600 });
  const environment = { ...process.env, PGPASSWORD: password };
  const run = (name: string, args: string[]) => ownedCommand(binary(name), args, environment, '', { timeoutMs: 60000 });
  let started = false;
  async function close() {
    if (!started) return;
    if (await readFile(marker, 'utf8') !== owner) throw new Error('Portable PostgreSQL ownership changed; refusing cleanup');
    await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    started = false;
  }
  try {
    if(stoppedSnapshot){
      if(!isAbsolute(stoppedSnapshot))throw new Error('Stopped fixture snapshot must use an absolute directory');
      const major=(await readFile(join(stoppedSnapshot,'PG_VERSION'),'utf8')).trim(),version=(await run('postgres',['--version'])).stdout;
      if(!version.includes(` ${major}.`))throw new Error('Stopped fixture snapshot PostgreSQL major differs from this runtime');
      try{await readFile(join(stoppedSnapshot,'postmaster.pid'));throw new Error('Refusing a running PostgreSQL snapshot');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      await cp(stoppedSnapshot,data,{recursive:true,errorOnExist:true,force:false});
    }else await run('initdb', ['-D', data, '-U', 'postgres', '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    const port = await new Promise<number>((resolvePort, reject) => {
      const socket = createServer(); socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const selected = (socket.address() as { port: number }).port;
        socket.close(error => error ? reject(error) : resolvePort(selected));
      });
    });
    // pg_ctl targets only this fresh data directory; no service or scheduled task is registered.
    started = true;
    await new Promise<void>((resolveStart, reject) => {
      // The server inherits pg_ctl handles on Windows. Ignore handles here so readiness
      // waits on pg_ctl itself rather than a pipe held by the long-running server.
      const child = spawn(binary('pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'],
        { env: environment, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Portable PostgreSQL startup deadline exceeded')); }, 60000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolveStart() : reject(new Error(`Portable PostgreSQL start exited ${code}; inspect ${join(directory, 'postgres.log')}`)); });
    });
    const base = `postgresql://postgres:${password}@127.0.0.1:${port}`;
    const client = new pg.Client({ connectionString: `${base}/postgres` });
    try {
      await client.connect();
      if (!/^[a-z_]+$/.test(database)) throw new Error('Invalid isolated database name');
      if(!stoppedSnapshot)await client.query(`CREATE DATABASE "${database}"`);
    } finally { await client.end(); }
    return { url: `${base}/${database}`, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Portable PostgreSQL startup and cleanup failed'); }
    throw error;
  } finally { await unlink(passwordFile); }
}
