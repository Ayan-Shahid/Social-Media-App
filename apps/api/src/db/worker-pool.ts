// Database access for background workers, as the glimpse_worker role (DECISIONS.md D13).
import pg from "pg";
import { config } from "../config.js";

let pool: pg.Pool | null = null;
export function workerPool() {
  pool ??= new pg.Pool({ connectionString: config.WORKER_DATABASE_URL ?? config.DATABASE_URL, max: 5 });
  return pool;
}
export async function closeWorkerPool() { await pool?.end(); pool = null; }
