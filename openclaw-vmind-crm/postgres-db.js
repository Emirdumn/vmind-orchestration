import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const here = dirname(fileURLToPath(import.meta.url));
const sqlDirectory = join(here, "sql");

export function postgresConfig(env = process.env) {
  const connectionString = String(env.VMIND_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
  const config = {
    application_name: "vmind-crm",
    max: Number(env.VMIND_PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
  if (connectionString) config.connectionString = connectionString;
  return config;
}

export function createPostgresPool(options = {}) {
  return new Pool({ ...postgresConfig(options.env), ...(options.config ?? {}) });
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

export async function applyPostgresMigrations(pool, options = {}) {
  const directory = options.directory ?? sqlDirectory;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('vmind_platform_migrations'))");
    await client.query("CREATE SCHEMA IF NOT EXISTS platform");
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(directory))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    const applied = [];
    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      const digest = checksum(sql);
      const existing = await client.query(
        "SELECT checksum FROM platform.schema_migrations WHERE version = $1",
        [file],
      );
      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== digest) {
          throw new Error(`Uygulanmış migration değiştirilemez: ${file}`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO platform.schema_migrations(version, checksum) VALUES ($1, $2)",
          [file, digest],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied, current: files };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('vmind_platform_migrations'))");
    } finally {
      client.release();
    }
  }
}

export async function closePool(pool) {
  await pool.end();
}
