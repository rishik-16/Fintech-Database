"""
Migration runner for PayLedger.
Applies numbered SQL migrations from db/migrations/ in order.
Tracks applied migrations in a _migrations table.
"""
import glob
import os
import sys
import psycopg


def load_env():
    """Load key-value pairs from .env if present without overriding existing env vars."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), ".env"),
    ]
    for candidate in candidates:
        candidate = os.path.abspath(candidate)
        if os.path.isfile(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v
            break


def get_database_url() -> str:
    """Resolve database URL from environment or configuration."""
    load_env()
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        if "@db:" in db_url and not os.path.exists("/.dockerenv") and not os.path.exists("/app"):
            db_url = db_url.replace("@db:", "@localhost:")
        return db_url

    user = os.environ.get("POSTGRES_USER", "payledger_admin")
    password = os.environ.get("POSTGRES_PASSWORD", "payledger_secret_2024")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    if host == "db" and not os.path.exists("/.dockerenv") and not os.path.exists("/app"):
        host = "localhost"
    port = os.environ.get("POSTGRES_PORT", "5432")
    dbname = os.environ.get("POSTGRES_DB", "payledger")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def find_migrations_dir() -> str:
    """Resolve db/migrations directory across container and local environments."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "db", "migrations"),
        os.path.join(os.path.dirname(__file__), "db", "migrations"),
        "/app/db/migrations",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db", "migrations")),
    ]
    for d in candidates:
        if os.path.isdir(d) and len(glob.glob(os.path.join(d, "*.sql"))) > 0:
            return os.path.abspath(d)
    return os.path.abspath(candidates[0])


def run_migrations():
    """Apply all pending migrations in order."""
    db_url = get_database_url()
    try:
        conn = psycopg.connect(db_url, autocommit=False)
    except Exception as e:
        print(f"Error connecting to database ({db_url.split('@')[-1] if '@' in db_url else db_url}): {e}")
        sys.exit(1)

    migrations_dir = find_migrations_dir()

    try:
        # Create migrations tracking table if not exists
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS _migrations (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(500) UNIQUE NOT NULL,
                    applied_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            conn.commit()

            # Get already applied migrations
            cur.execute("SELECT filename FROM _migrations ORDER BY filename")
            applied = {row[0] for row in cur.fetchall()}

        pattern = os.path.join(migrations_dir, "*.sql")
        migration_files = sorted(glob.glob(pattern))

        if not migration_files:
            print(f"Error: No migration files found in {migrations_dir}")
            sys.exit(1)

        print(f"Applying migrations from: {migrations_dir}")
        pending = 0

        for filepath in migration_files:
            filename = os.path.basename(filepath)
            if filename in applied:
                print(f"  [OK] {filename} (already applied)")
                continue

            print(f"  -> Applying {filename} ...", end=" ", flush=True)
            with open(filepath, "r", encoding="utf-8") as f:
                sql = f.read()

            try:
                with conn.cursor() as cur:
                    cur.execute(sql)
                    cur.execute(
                        "INSERT INTO _migrations (filename) VALUES (%s)",
                        (filename,)
                    )
                conn.commit()
                print("OK")
                pending += 1
            except Exception as e:
                conn.rollback()
                print(f"FAILED\n    Error: {e}")
                sys.exit(1)

        if pending == 0:
            print("All migrations are already up to date.")
        else:
            print(f"\nSuccessfully applied {pending} migration(s).")

    finally:
        conn.close()


if __name__ == "__main__":
    print("=" * 50)
    print("PayLedger Database Migration Engine")
    print("=" * 50)
    run_migrations()
