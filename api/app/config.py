"""
PayLedger configuration loaded from environment variables.
"""
import os
from pydantic_settings import BaseSettings

_env_candidates = [
    os.path.join(os.getcwd(), ".env"),
    os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env"),
]
_env_file = next((f for f in _env_candidates if os.path.isfile(f)), ".env")


class Settings(BaseSettings):
    database_url: str = "postgresql://payledger_admin:payledger_secret_2024@db:5432/payledger"
    jwt_secret: str = "dev-jwt-secret-key-change-in-production-abc123def456"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    kyc_hmac_secret: str = "dev-kyc-hmac-secret-change-in-production-789xyz"

    class Config:
        env_file = _env_file
        extra = "ignore"


settings = Settings()
