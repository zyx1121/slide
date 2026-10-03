const MIGRATION_FILE = /^\d{4}_[\w-]+\.sql$/;

/** Migration files, `NNNN_name.sql`, in the order they are applied. */
export function migrationNames(files: string[]): string[] {
  return files.filter((file) => MIGRATION_FILE.test(file)).sort();
}

/**
 * SQL files that look like migrations but would be skipped because of their
 * name (`001_x.sql`, `0003_x.SQL`). The runner refuses to start when any exist.
 */
export function misnamedMigrations(files: string[]): string[] {
  return files
    .filter((file) => /\.sql$/i.test(file) && !MIGRATION_FILE.test(file))
    .sort();
}

/** Migrations present on disk that the database has not recorded yet. */
export function pendingMigrations(
  files: string[],
  applied: Iterable<string>
): string[] {
  const done = new Set(applied);
  return migrationNames(files).filter((name) => !done.has(name));
}
