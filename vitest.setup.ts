// Runs before every test file loads (vitest.config.ts setupFiles). Tests never touch the
// shared demo database: the runtime picks Postgres whenever DATABASE_URL is set, and the
// API tests reset their store before each test. So the URL is cleared here, before any
// test module can read it. The one exception is lib/store/postgres.live.test.ts, which
// opts in with LIVE_DB=1 and works in its own schema.

export function clearTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  // Simulation tests use isolated local files and PGlite, even on a host with a live archive configured.
  delete env.AEGIS_DEMO_STORAGE_URL;
  if (env.LIVE_DB === "1") return;
  delete env.DATABASE_URL;
  delete env.DATABASE_CA_FILE;
}

clearTestDatabase();
