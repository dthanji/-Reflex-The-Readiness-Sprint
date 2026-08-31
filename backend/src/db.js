const { Pool } = require('pg');

// Render (and most managed Postgres hosts) provide a single DATABASE_URL
// connection string. Prefer it when present; fall back to individual
// PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE vars for local development
// and any host that doesn't provide a connection string.
//
// SSL: Render's *external* database URL requires SSL; its *internal* URL
// (used when your web service and database are in the same Render account/
// region) does not. Control this explicitly via PGSSLMODE=require rather
// than guessing from the connection string, since guessing wrong either
// breaks the connection or silently disables a security feature.
const sslConfig = process.env.PGSSLMODE === 'require'
  ? { rejectUnauthorized: false }
  : false;

let poolConfig;
if (process.env.DATABASE_URL) {
  poolConfig = { connectionString: process.env.DATABASE_URL, ssl: sslConfig };
} else {
  const password = process.env.PGPASSWORD;
  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error(
      'PGPASSWORD (or DATABASE_URL) is not set. Refusing to start in ' +
      'production without database credentials.'
    );
  }
  poolConfig = {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: password || 'reflex', // dev-only default, never used in production (see check above)
    database: process.env.PGDATABASE || 'reflex',
    ssl: sslConfig,
  };
}

const pool = new Pool(poolConfig);

module.exports = { pool };
