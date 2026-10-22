import { sql } from "drizzle-orm";
/** `(…)` list of uuid parameters for `in` clauses. Always parameterized, never string-built. */
export const uuidList = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;
