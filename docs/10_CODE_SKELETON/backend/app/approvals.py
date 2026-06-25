from enum import Enum
from fastapi import HTTPException
from pydantic import BaseModel

class ApprovalStatus(str, Enum):
    PENDING = "pending"
    AUTO_VALIDATING = "auto_validating"
    AUTO_FAILED = "auto_failed"
    REMEDIATION_REQUIRED = "remediation_required"
    READY = "ready_for_human_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    CHANGE_REQUESTED = "change_requested"
    OVERRIDE_REQUESTED = "override_requested"
    OVERRIDE_APPROVED = "override_approved"

class ApprovalDecisionRequest(BaseModel):
    decision: str
    comment: str

def decide_approval(approval, actor_persona_id, payload: ApprovalDecisionRequest):
    # 일반 승인은 READY 상태에서만 가능하다.
    if payload.decision == "approved" and approval.status != ApprovalStatus.READY:
        raise HTTPException(
            status_code=409,
            detail="Approval can only be approved from ready_for_human_approval"
        )

    # TODO: verify actor_persona_id is eligible approver for this gate.
    # TODO: verify artifact_version is not stale.
    # TODO: write audit log.

    approval.status = payload.decision
    approval.decided_by_persona_id = actor_persona_id
    approval.decision_comment = payload.comment
    return approval
