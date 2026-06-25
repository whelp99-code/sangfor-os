from __future__ import annotations

from datetime import date
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel

from .auth import AuthContext, get_auth_context, require_role, require_permission
from .quotes import QuoteLineItemIn, calculate_quote
from .approvals import ApprovalDecisionRequest
from .vendor import VendorRequestCreate, DiscountRequestCreate, DemoLicenseRequestCreate
from .assets import CustomerAssetCreate, AssetLicenseCreate
from .renewals import RenewalGenerateRequest, renewal_due_window
from .certifications import EngineerCertificationCreate, SkillMatrixUpdate
from .data_exports import ArtifactExportRequest
from .ai_quality import AIEvaluationRunRequest, release_gate_passed
from .poc import POCProjectCreate, POCResourceCreate
from .color_agents import ColorRoutingInput, route_color_agents
from .handoffs import HandoffCreate, HandoffDecision, validate_handoff
from .color_review_gates import ColorGateCheckInput, check_color_gate

app = FastAPI(title="Agentic Company OS - SANGFOR Partner Pack V3.2")


class CustomerCreate(BaseModel):
    name: str
    segment: str | None = None
    industry: str | None = None
    primary_contact: dict | None = None


class OpportunityCreate(BaseModel):
    customer_id: str
    title: str
    estimated_revenue: float | None = None
    expected_close_date: str | None = None
    product_family_keys: list[str] = []
    pain_points: list[str] = []
    competitor_id: str | None = None
    decision_maker: str | None = None
    technical_influencer: str | None = None


class DealQualificationCreate(BaseModel):
    budget_score: int
    authority_score: int
    need_score: int
    timeline_score: int
    technical_fit_score: int
    strategic_fit_score: int
    competitive_risk: str
    recommendation: str
    notes: str | None = None


class QuoteCreate(BaseModel):
    currency: str = "KRW"
    line_items: list[QuoteLineItemIn]


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "3.2"}


@app.post("/api/customers")
async def create_customer(payload: CustomerCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "customer.write")
    return {
        "message": "customer creation skeleton",
        "tenant_id_source": "auth_context",
        "company_id_source": "auth_context",
        "payload": payload.model_dump()
    }


@app.post("/api/opportunities")
async def create_opportunity(payload: OpportunityCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "opportunity.write")
    return {"message": "opportunity creation skeleton", "payload": payload.model_dump()}


@app.post("/api/opportunities/{opportunity_id}/qualification")
async def create_deal_qualification(opportunity_id: str, payload: DealQualificationCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "opportunity.write")
    # TODO: insert deal_qualification_scores scoped by auth tenant/company.
    return {"opportunity_id": opportunity_id, "message": "qualification score skeleton", "payload": payload.model_dump()}


@app.post("/api/opportunities/{opportunity_id}/quotes")
async def create_quote(opportunity_id: str, payload: QuoteCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "quote.write")
    totals = calculate_quote(payload.line_items)
    return {"opportunity_id": opportunity_id, "currency": payload.currency, "totals": totals}


@app.post("/api/quotes/{quote_id}/discount-requests")
async def create_discount_request(quote_id: str, payload: DiscountRequestCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "discount_request.write")
    return {"quote_id": quote_id, "message": "discount request skeleton", "payload": payload.model_dump()}


@app.post("/api/opportunities/{opportunity_id}/vendor-requests")
async def create_vendor_request(opportunity_id: str, payload: VendorRequestCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "vendor_request.write")
    return {"opportunity_id": opportunity_id, "message": "vendor request skeleton", "payload": payload.model_dump()}


@app.post("/api/demo-licenses")
async def request_demo_license(payload: DemoLicenseRequestCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "vendor_request.write")
    return {"message": "demo license request skeleton", "payload": payload.model_dump()}


@app.post("/api/poc-projects")
async def create_poc_project(payload: POCProjectCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "poc.write")
    missing = []
    if not payload.success_criteria:
        missing.append("success_criteria")
    if not payload.test_scenarios:
        missing.append("test_scenarios")
    if missing:
        raise HTTPException(status_code=422, detail={"missing": missing})
    return {"message": "poc project skeleton", "payload": payload.model_dump()}


@app.post("/api/poc-resources")
async def reserve_poc_resource(payload: POCResourceCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "poc.write")
    return {"message": "poc resource reservation skeleton", "payload": payload.model_dump()}


@app.post("/api/customer-assets")
async def create_customer_asset(payload: CustomerAssetCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "asset.write")
    return {"message": "customer asset/license/subscription skeleton", "payload": payload.model_dump()}


@app.post("/api/asset-licenses")
async def create_asset_license(payload: AssetLicenseCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "asset.write")
    return {"message": "asset license skeleton", "payload": payload.model_dump()}


@app.post("/api/renewal-opportunities/generate")
async def generate_renewals(payload: RenewalGenerateRequest, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "renewal.write")
    start, end = renewal_due_window(date.today(), payload.days_ahead)
    # TODO: query subscriptions ending between start/end and upsert renewal_opportunities.
    return {"message": "renewal generation skeleton", "window": {"start": str(start), "end": str(end)}}


@app.post("/api/support-cases/{support_case_id}/vendor-escalations")
async def create_vendor_escalation(support_case_id: str, payload: VendorRequestCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "vendor_escalation.write")
    return {"support_case_id": support_case_id, "message": "vendor escalation skeleton", "payload": payload.model_dump()}


@app.post("/api/engineer-certifications")
async def create_engineer_certification(payload: EngineerCertificationCreate, auth: AuthContext = Depends(get_auth_context)):
    require_role(auth, {"system_admin", "security_officer", "ceo"})
    return {"message": "engineer certification skeleton", "payload": payload.model_dump()}


@app.post("/api/skill-matrix")
async def update_skill_matrix(payload: SkillMatrixUpdate, auth: AuthContext = Depends(get_auth_context)):
    require_role(auth, {"system_admin", "security_officer", "ceo"})
    return {"message": "skill matrix skeleton", "payload": payload.model_dump()}


@app.post("/api/artifacts/{artifact_id}/export-requests")
async def create_artifact_export_request(artifact_id: str, payload: ArtifactExportRequest, auth: AuthContext = Depends(get_auth_context)):
    # TODO: load artifact classification and enforce export approval using policies.assert_can_export_artifact.
    return {"artifact_id": artifact_id, "message": "data export request skeleton", "payload": payload.model_dump()}


@app.post("/api/ai/evaluations/run")
async def run_ai_evaluation(payload: AIEvaluationRunRequest, auth: AuthContext = Depends(get_auth_context)):
    require_role(auth, {"security_officer", "solution_architect", "ceo"})
    # TODO: run prompt/model against ai_golden_answers.
    simulated_score = 87.5
    passed = release_gate_passed(simulated_score, prompt_injection_block_rate=96.0, restricted_leakage_count=0)
    return {"score": simulated_score, "passed": passed, "release_gate": "passed" if passed else "failed"}


@app.post("/api/approvals/{approval_id}/decision")
async def approval_decision(approval_id: str, payload: ApprovalDecisionRequest, auth: AuthContext = Depends(get_auth_context)):
    # TODO:
    # 1. load approval by id scoped to auth.tenant_id/auth.company_id
    # 2. resolve approver_persona_id from auth, not request body
    # 3. run state machine
    # 4. write audit log
    # 5. reject stale artifact_version
    raise HTTPException(status_code=501, detail="Approval decision skeleton")


@app.post("/api/color-agents/route")
async def route_color_agent_review(payload: ColorRoutingInput, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "color_agent.route")
    return route_color_agents(payload).model_dump()


@app.post("/api/kanban/handoffs")
async def create_kanban_handoff(payload: HandoffCreate, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "handoff.write")
    errors = validate_handoff(payload)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    # TODO: persist kanban_handoff_cards scoped by auth.tenant_id/auth.company_id and write audit log.
    return {"message": "kanban handoff skeleton", "tenant_id_source": "auth_context", "payload": payload.model_dump()}


@app.post("/api/kanban/handoffs/{handoff_id}/decision")
async def decide_kanban_handoff(handoff_id: str, payload: HandoffDecision, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "handoff.write")
    # TODO: load card by id scoped to auth tenant/company, enforce assigned color/persona, append handoff_events and audit log.
    return {"handoff_id": handoff_id, "message": "handoff decision skeleton", "payload": payload.model_dump()}


@app.post("/api/color-review-gates/check")
async def check_color_review_gate(payload: ColorGateCheckInput, auth: AuthContext = Depends(get_auth_context)):
    require_permission(auth, "approval.read")
    return check_color_gate(payload).model_dump()
