"""
Cryptographic utilities for PayLedger.
Provides keyed HMAC-SHA256 hashing for sensitive KYC identifiers and identifier normalization.
"""
import hashlib
import hmac
import os
from typing import Optional

from app.config import settings


def normalize_kyc_identifier(raw_identifier: str) -> str:
    """
    Normalize a raw government KYC identifier (e.g. Aadhaar, PAN, Passport).
    - Trims leading and trailing whitespace.
    - Removes internal spaces and hyphens commonly present in formatted input.
    - Converts letters to uppercase for consistency across alphanumeric IDs.
    
    Raises ValueError if raw_identifier is empty or contains no valid characters.
    """
    if not raw_identifier or not isinstance(raw_identifier, str):
        raise ValueError("KYC identifier must be a non-empty string")
    
    cleaned = "".join(raw_identifier.strip().split())
    cleaned = cleaned.replace("-", "").upper()
    
    if not cleaned:
        raise ValueError("KYC identifier cannot be empty after normalization")
    
    return cleaned


def hash_kyc_identifier(raw_identifier: str, secret_key: Optional[str] = None) -> str:
    """
    Compute keyed HMAC-SHA256 hex digest of a normalized KYC identifier.

    The secret key is loaded from the external secret management configuration
    (environment variable KYC_HMAC_SECRET or application settings). It must
    NEVER be stored in PostgreSQL or database catalogs.
    
    Raw identification numbers are never logged, persisted, or leaked.
    """
    key = secret_key or os.environ.get("KYC_HMAC_SECRET") or settings.kyc_hmac_secret
    if not key:
        raise ValueError(
            "KYC HMAC secret key is not configured. "
            "Set the KYC_HMAC_SECRET environment variable outside PostgreSQL."
        )
    
    normalized = normalize_kyc_identifier(raw_identifier)
    
    # Keyed HMAC-SHA256 digest
    digest = hmac.new(
        key.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    
    return digest

