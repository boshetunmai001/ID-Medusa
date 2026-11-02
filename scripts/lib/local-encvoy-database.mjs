const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Allow source migrations only on the separate local source-build database. */
export function assertLocalEncvoyDatabase(value) {
  let database;
  try {
    database = new URL(value);
  } catch {
    throw new Error("Encvoy source migrations require a valid local DATABASE_URL.");
  }

  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !LOCAL_HOSTS.has(database.hostname) ||
    database.port !== "55433" ||
    decodeURIComponent(database.pathname.slice(1)) !== "encvoy_source" ||
    database.search ||
    database.hash
  ) {
    throw new Error(
      "Refusing Encvoy source migrations: DATABASE_URL must target the isolated localhost:55433/encvoy_source database without URL overrides.",
    );
  }
}
