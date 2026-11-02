"""
PayLedger API — FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_pool, close_pool
from app.routers import auth, wallet, lending, risk, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    init_pool()
    yield
    close_pool()


app = FastAPI(
    title="PayLedger API",
    description="Simulated fintech platform — Digital Wallet, Lending & Fraud Detection",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(wallet.router, prefix="/api/wallet", tags=["Wallet & Ledger"])
app.include_router(lending.router, prefix="/api/lending", tags=["Lending"])
app.include_router(risk.router, prefix="/api/risk", tags=["Risk & Fraud"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "PayLedger API"}
