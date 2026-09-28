import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connect, digest, migrate, newCredential } from './database.js';

// Offline operator command: no privileged account or default credentials in the HTTP API.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
let input = ''; for await (const part of process.stdin) input += part;
const { name, canManageIdentities } = z.object({ name: z.string().min(1).max(256), canManageIdentities: z.boolean().default(false) }).strict().parse(JSON.parse(input));
const db = connect(process.env.DATABASE_URL);
try {
  await migrate(db);
  const id = randomUUID(); const readerCredential = newCredential(); const enrollmentCredential = newCredential();
  await db.query('INSERT INTO employees(id,name,reader_hash,enrollment_hash,can_manage_identities) VALUES($1,$2,$3,$4,$5)',
    [id, name, digest(readerCredential), digest(enrollmentCredential), canManageIdentities]);
  console.log(JSON.stringify({ employeeId: id, name, readerCredential, enrollmentCredential, canManageIdentities }));
} finally { await db.end(); }
