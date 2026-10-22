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

export async function runMigrations(ownerUrl: string, appRole: string, appPassword: string | undefined) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const role = client.escapeIdentifier(appRole);
    const exists = await client.query("select 1 from pg_roles where rolname = $1", [appRole]);
    if (!exists.rowCount) await client.query(`create role ${role} login nosuperuser nobypassrls nocreatedb nocreaterole`);
    await client.query(`alter role ${role} login nosuperuser nobypassrls nocreatedb nocreaterole`);
    if (appPassword) await client.query(`alter role ${role} password ${client.escapeLiteral(appPassword)}`);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) { console.error("MIGRATION_DATABASE_URL is required"); process.exit(1); }
  runMigrations(ownerUrl, process.env.APP_DB_ROLE ?? "glimpse_app", process.env.APP_DB_PASSWORD)
    .then(() => { console.log("Migrations applied."); })
    .catch((e) => { console.error(e); process.exit(1); });
}
