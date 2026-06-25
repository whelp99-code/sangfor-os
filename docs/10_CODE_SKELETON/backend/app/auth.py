from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


class AuthSettings(BaseModel):
    """
    Contractor note:
    - Replace defaults with environment variables.
    - For production, use OIDC issuer + JWKS validation.
    - Never accept unsigned JWTs.
    """
    oidc_issuer: str = Field(default="https://identity.example.com")
    oidc_audience: str = Field(default="agentic-company-os")
    privileged_roles: set[str] = Field(default_factory=lambda: {
        "ceo", "finance_manager", "security_officer", "system_admin"
    })


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    tenant_id: UUID
    company_id: UUID
    roles: list[str]
    personas: list[str]
    clearance: str = "internal"
    mfa_verified: bool = False
    request_id: str = ""


class JwtClaims(BaseModel):
    sub: UUID
    tenant_id: UUID
    company_id: UUID
    roles: list[str] = []
    personas: list[str] = []
    clearance: str = "internal"
    mfa_verified: bool = False


class OIDCVerifier:
    """
    Production adapter skeleton.

    Expected implementation:
    1. Download and cache JWKS from issuer.
    2. Verify JWT signature, iss, aud, exp, nbf.
    3. Reject disabled users by checking local users table.
    4. Load roles/personas from DB instead of trusting token blindly
       unless the IdP is the source of truth.
    """

    def __init__(self, settings: AuthSettings):
        self.settings = settings

    async def verify(self, token: str) -> JwtClaims:
        # Implementation options for contractors:
        # - authlib.integrations.starlette_client
        # - python-jose
        # - PyJWT + PyJWKClient
        #
        # This skeleton deliberately fails closed until wired to a real IdP.
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="OIDC/JWT verifier is not configured"
        )


async def get_auth_context(
    request: Request,
    token: str = Depends(oauth2_scheme),
    settings: AuthSettings = Depends(get_auth_settings),
) -> AuthContext:
    verifier = OIDCVerifier(settings)
    claims = await verifier.verify(token)

    roles = list(set(claims.roles))
    has_privileged = bool(settings.privileged_roles.intersection(roles))
    if has_privileged and not claims.mfa_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="MFA is required for privileged roles"
        )

    return AuthContext(
        user_id=claims.sub,
        tenant_id=claims.tenant_id,
        company_id=claims.company_id,
        roles=roles,
        personas=list(set(claims.personas)),
        clearance=claims.clearance,
        mfa_verified=claims.mfa_verified,
        request_id=request.headers.get("x-request-id", ""),
    )


def require_role(auth: AuthContext, allowed: set[str]) -> None:
    if not set(auth.roles).intersection(allowed):
        raise HTTPException(status_code=403, detail="Forbidden")


def require_permission(auth: AuthContext, permission: str) -> None:
    """
    MVP skeleton maps permission checks to roles in policies.py.
    Production implementation should use a permission table/cache.
    """
    from .policies import permission_allowed
    if not permission_allowed(auth, permission):
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")


def ensure_same_subject_not_privilege_target(auth: AuthContext, target_user_id: UUID, roles_to_grant: list[str]) -> None:
    high_risk = {"ceo", "finance_manager", "security_officer", "system_admin"}
    if auth.user_id == target_user_id and high_risk.intersection(set(roles_to_grant)):
        raise HTTPException(status_code=403, detail="Self privilege escalation is not allowed")
