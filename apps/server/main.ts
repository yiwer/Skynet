import { resolve } from 'node:path';
import { createApp } from './app.js';
import { connect } from './database.js';

if (!process.env.DATABASE_URL || !process.env.RAW_DIRECTORY) throw new Error('DATABASE_URL and RAW_DIRECTORY are required');
const db = connect(process.env.DATABASE_URL);
const app = await createApp({ db, rawDirectory: resolve(process.env.RAW_DIRECTORY), webDirectory: resolve('dist/web'), publicOrigin: process.env.SKYNET_PUBLIC_ORIGIN });
const stop = async () => { await app.close(); await db.end(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
console.log(`Skynet listening on ${app.listeningOrigin}; native capture capability unverified`);
