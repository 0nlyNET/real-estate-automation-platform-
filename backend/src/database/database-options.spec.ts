import { buildDatabaseOptions } from "./database-options";

describe("database migration startup policy", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRunMigrations = process.env.RUN_MIGRATIONS;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRunMigrations === undefined) delete process.env.RUN_MIGRATIONS;
    else process.env.RUN_MIGRATIONS = originalRunMigrations;
  });

  it("runs migrations by default in deployed runtimes", () => {
    delete process.env.NODE_ENV;
    delete process.env.RUN_MIGRATIONS;

    expect(buildDatabaseOptions().migrationsRun).toBe(true);
  });

  it("does not mutate test databases unless explicitly requested", () => {
    process.env.NODE_ENV = "test";
    delete process.env.RUN_MIGRATIONS;

    expect(buildDatabaseOptions().migrationsRun).toBe(false);

    process.env.RUN_MIGRATIONS = "true";
    expect(buildDatabaseOptions().migrationsRun).toBe(true);
  });

  it("honors an explicit production opt-out", () => {
    process.env.NODE_ENV = "production";
    process.env.RUN_MIGRATIONS = "false";

    expect(
      buildDatabaseOptions('postgres://postgres:postgres@localhost:5432/app')
        .migrationsRun,
    ).toBe(false);
  });

  it('never falls back to default database credentials in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => buildDatabaseOptions('')).toThrow(
      'DATABASE_URL is required in production',
    );
  });
});
