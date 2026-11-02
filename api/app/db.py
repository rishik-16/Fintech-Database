"""
Database connection pool using psycopg v3.
Provides helper functions for executing queries with plain SQL.
"""
import contextlib
from typing import Any, Optional

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

from app.config import settings

# Global connection pool - initialized on app startup
pool: Optional[ConnectionPool] = None


def init_pool():
    """Initialize the connection pool. Called on app startup."""
    global pool
    pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=5,
        max_size=20,
        kwargs={"row_factory": dict_row},
    )


def close_pool():
    """Close the connection pool. Called on app shutdown."""
    global pool
    if pool:
        pool.close()
        pool = None


def get_pool() -> ConnectionPool:
    """Return the active connection pool, initializing lazily if needed."""
    global pool
    if pool is None:
        init_pool()
    return pool


def clean_db_error(exc: Exception) -> str:
    """Extract a user-safe error message from a database exception, omitting internal context."""
    if hasattr(exc, "diag") and exc.diag and exc.diag.message_primary:
        return exc.diag.message_primary
    msg = str(exc).split("\n")[0].strip()
    if msg.startswith("ERROR:"):
        msg = msg[6:].strip()
    return msg or "An unexpected database error occurred"


@contextlib.contextmanager
def get_conn(user_id: Optional[str] = None, user_role: Optional[str] = None):
    """
    Get a database connection from the pool.
    Sets session variables and role for RLS enforcement.
    Guarantees session state and roles are reset upon release back to the pool.
    """
    active_pool = get_pool()
    role_set = False
    with active_pool.connection() as conn:
        try:
            if user_id:
                conn.execute(
                    "SELECT set_config('payledger.current_user_id', %s, false)", (str(user_id),)
                )
            if user_role:
                conn.execute(
                    "SELECT set_config('payledger.current_user_role', %s, false)", (str(user_role),)
                )
                role_map = {
                    "customer": "app_customer",
                    "merchant": "app_merchant",
                    "loan_officer": "app_officer",
                    "risk_analyst": "app_risk",
                    "admin": "app_admin",
                }
                db_role = role_map.get(user_role)
                if db_role:
                    try:
                        conn.execute(f"SET ROLE {db_role}")
                        role_set = True
                    except Exception:
                        pass
            # Set search path to our schema
            conn.execute("SET search_path = payledger, public")
            yield conn
        finally:
            try:
                if role_set:
                    conn.execute("RESET ROLE")
                conn.execute(
                    "SELECT set_config('payledger.current_user_id', '', false), "
                    "       set_config('payledger.current_user_role', '', false)"
                )
            except Exception:
                pass


def fetch_one(query: str, params: tuple = (), user_id=None, user_role=None) -> Optional[dict]:
    """Execute a query and return one row as a dict, or None."""
    with get_conn(user_id, user_role) as conn:
        row = conn.execute(query, params).fetchone()
        return dict(row) if row else None


def fetch_all(query: str, params: tuple = (), user_id=None, user_role=None) -> list[dict]:
    """Execute a query and return all rows as dicts."""
    with get_conn(user_id, user_role) as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def execute(query: str, params: tuple = (), user_id=None, user_role=None) -> Any:
    """Execute a query (INSERT/UPDATE/DELETE) and return the result."""
    with get_conn(user_id, user_role) as conn:
        result = conn.execute(query, params)
        conn.commit()
        return result


def call_procedure(proc_name: str, params: tuple = (), user_id=None, user_role=None) -> Optional[dict]:
    """Call a stored procedure/function and return the result."""
    placeholders = ", ".join(["%s"] * len(params))
    query = f"SELECT * FROM payledger.{proc_name}({placeholders})"
    with get_conn(user_id, user_role) as conn:
        row = conn.execute(query, params).fetchone()
        conn.commit()
        return dict(row) if row else None


def call_procedure_scalar(proc_name: str, params: tuple = (), user_id=None, user_role=None) -> Any:
    """Call a stored procedure/function that returns a single value."""
    placeholders = ", ".join(["%s"] * len(params))
    query = f"SELECT payledger.{proc_name}({placeholders})"
    with get_conn(user_id, user_role) as conn:
        row = conn.execute(query, params).fetchone()
        conn.commit()
        if row:
            # dict_row returns dict, get first value
            return list(row.values())[0]
        return None
