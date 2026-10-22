// Migration runner. Runs as the database OWNER (never as the app role):
//  1. Creates or updates the app role (login, no superuser, cannot bypass RLS).
//  2. Applies every pending migration in ./migrations, in order, recorded in drizzle.__drizzle_migrations.
// Safe to run on every deploy: already-applied migrations are skipped.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../migrations");

async function ensureRole(client: pg.Client, name: string, attrs: string, password: string | undefined) {
  const role = client.escapeIdentifier(name);
  const exists = await client.query("select 1 from pg_roles where rolname = $1", [name]);
  if (!exists.rowCount) await client.query(`create role ${role} ${attrs}`);
  await client.query(`alter role ${role} ${attrs}`);
  if (password) await client.query(`alter role ${role} password ${client.escapeLiteral(password)}`);
}

export async function runMigrations(ownerUrl: string, appRole: string, appPassword: string | undefined, workerPassword?: string) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // App role: every API request. Can never bypass row-level security.
    await ensureRole(client, appRole, "login nosuperuser nobypassrls nocreatedb nocreaterole", appPassword);
    // Worker role: background jobs doing system work for many users (DECISIONS.md D13).
    await ensureRole(client, "glimpse_worker", "login nosuperuser bypassrls nocreatedb nocreaterole", workerPassword);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) { console.error("MIGRATION_DATABASE_URL is required"); process.exit(1); }
  runMigrations(ownerUrl, process.env.APP_DB_ROLE ?? "glimpse_app", process.env.APP_DB_PASSWORD, process.env.WORKER_DB_PASSWORD)
    .then(() => { console.log("Migrations applied."); })
    .catch((e) => { console.error(e); process.exit(1); });
}
