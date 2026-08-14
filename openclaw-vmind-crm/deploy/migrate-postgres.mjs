#!/usr/bin/env node

import { applyPostgresMigrations, createPostgresPool } from "../postgres-db.js";

const pool = createPostgresPool();
try {
  const result = await applyPostgresMigrations(pool);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} finally {
  await pool.end();
}
