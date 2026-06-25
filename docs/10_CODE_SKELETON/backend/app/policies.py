from __future__ import annotations

from uuid import UUID
from fastapi import HTTPException

from .auth import AuthContext

CLASSIFICATION_ORDER = {
    "public": 0,
    "internal": 1,
    "confidential": 2,
    "restricted": 3,
    "regulated_personal_data": 4,
}

ROLE_PERMISSIONS = {
    "ceo": {
        "opportunity.read", "opportunity.write",
        "quote.read", "quote.approve",
        "approval.decide", "approval.override",
        "artifact.read", "artifact.export.approve",
        "renewal.read", "renewal.write",
        "dashboard.executive",
    },
    "sales_manager": {
        "customer.read", "customer.write",
        "opportunity.read", "opportunity.write",
        "artifact.read", "artifact.write",
        "quote.read", "quote.write",
        "vendor_request.write",
        "renewal.read",
    },
    "account_manager": {
        "customer.read", "customer.write",
        "opportunity.read", "opportunity.write",
        "renewal.read", "renewal.write",
        "support.read",
    },
    "presales_engineer": {
        "opportunity.read",
        "artifact.read", "artifact.write",
        "solution_fit.write",
        "poc.read", "poc.write",
        "vendor_request.write",
    },
    "solution_architect": {
        "opportunity.read",
        "artifact.read", "artifact.write",
        "approval.decide",
        "poc.read", "delivery.read",
    },
    "finance_manager": {
        "quote.read", "quote.write", "quote.approve",
        "discount_request.read", "discount_request.write",
        "approval.decide",
    },
    "delivery_engineer": {
        "delivery.read", "delivery.write",
        "asset.read", "asset.write",
        "artifact.read", "artifact.write",
    },
    "support_engineer": {
        "support.read", "support.write",
        "vendor_escalation.write",
        "asset.read",
        "artifact.read", "artifact.write",
    },
    "security_officer": {
        "audit.read", "policy.read", "policy.write",
        "artifact.export.approve",
        "ai.quality.approve",
        "role_change.approve",
    },
    "system_admin": {
        "user.read", "user.write",
        "role_change.request",
        "system.health.read",
    },
}

EXPORT_PERMISSIONS = {
    "public": "artifact.export",
    "internal": "artifact.export",
    "confidential": "artifact.export.approve",
    "restricted": "artifact.export.approve",
    "regulated_personal_data": "artifact.export.approve",
}


def permission_allowed(auth: AuthContext, permission: str) -> bool:
    granted = set()
    for role in auth.roles:
        granted.update(ROLE_PERMISSIONS.get(role, set()))
    return permission in granted


def can_read_classification(auth: AuthContext, classification: str) -> bool:
    return CLASSIFICATION_ORDER.get(auth.clearance, 0) >= CLASSIFICATION_ORDER.get(classification, 99)


def assert_can_read_artifact(auth: AuthContext, artifact) -> None:
    if not can_read_classification(auth, artifact.classification):
        raise HTTPException(status_code=403, detail="Insufficient clearance")
    if not permission_allowed(auth, "artifact.read"):
        raise HTTPException(status_code=403, detail="Missing artifact.read")


def assert_can_export_artifact(auth: AuthContext, classification: str) -> None:
    required = EXPORT_PERMISSIONS.get(classification, "artifact.export.approve")
    if not permission_allowed(auth, required):
        raise HTTPException(status_code=403, detail="Export requires additional approval")


def assert_no_self_privilege_escalation(actor_user_id: UUID, target_user_id: UUID, roles_to_grant: list[str]) -> None:
    high_risk = {"ceo", "finance_manager", "security_officer", "system_admin"}
    if actor_user_id == target_user_id and high_risk.intersection(set(roles_to_grant)):
        raise HTTPException(status_code=403, detail="Self privilege escalation is not allowed")


def display_status_for_user(internal_status: str) -> str:
    mapping = {
        "ready_for_human_approval": "승인 대기",
        "auto_failed": "자동 검증 실패",
        "remediation_required": "수정 필요",
        "ai_draft": "AI 초안",
        "human_reviewed": "사람 검토 완료",
        "approved": "승인 완료",
        "superseded": "대체됨",
    }
    return mapping.get(internal_status, internal_status)
