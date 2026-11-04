import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

if (!process.env.TURSO_DATABASE_URL?.startsWith('file:') || process.env.TURSO_AUTH_TOKEN) {
  throw new Error('Fixture seed requires an isolated file database and no auth token');
}
if (!process.env.STUDYPOD_AUTH_EMAIL || !process.env.STUDYPOD_AUTH_PASSWORD ||
    !process.env.STUDYPOD_AUTH_SECOND_EMAIL || !process.env.STUDYPOD_AUTH_SECOND_PASSWORD) {
  throw new Error('Fixture credentials are missing');
}

const { initializeDatabase, dbHelpers } = await import('../backend/src/db/database.js');
await initializeDatabase();
await dbHelpers.createUser(randomBytes(16).toString('hex'), process.env.STUDYPOD_AUTH_EMAIL,
  await bcrypt.hash(process.env.STUDYPOD_AUTH_PASSWORD, 10), 'StudyPod acceptance account', 'human', null, null, 1, 0);
await dbHelpers.createUser(randomBytes(16).toString('hex'), process.env.STUDYPOD_AUTH_SECOND_EMAIL,
  await bcrypt.hash(process.env.STUDYPOD_AUTH_SECOND_PASSWORD, 10), 'StudyPod ownership acceptance', 'human', null, null, 1, 0);
// The local libsql client has no close hook exposed through database.js.
// This short-lived seed process exits after both rows are committed.
process.exit(0);
