-- U040: this migration runs only after the conservative U040 backfill has produced zero
-- unresolved catalog/orphan facts.  It never guesses or repairs source IDs.
DO $$
DECLARE unresolved bigint; renewal_orphans bigint; cross_scope bigint;
BEGIN
  SELECT count(*) INTO unresolved FROM product_families WHERE company_id IS NULL;
  IF unresolved <> 0 THEN RAISE EXCEPTION 'U040 blocks ProductFamily tightening: % unresolved rows', unresolved; END IF;
  SELECT count(*) INTO unresolved FROM license_metrics WHERE product_family_id IS NULL;
  IF unresolved <> 0 THEN RAISE EXCEPTION 'U040 blocks LicenseMetric tightening: % unresolved rows', unresolved; END IF;
  SELECT count(*) INTO renewal_orphans FROM renewal_opportunities ro
    LEFT JOIN customer_assets ca ON ca.id = ro.asset_id
    WHERE ro.asset_id IS NOT NULL AND ca.id IS NULL;
  IF renewal_orphans <> 0 THEN RAISE EXCEPTION 'U040 blocks renewal asset FK validation: % orphan rows', renewal_orphans; END IF;
  SELECT count(*) INTO cross_scope
    FROM opportunities opportunity
    JOIN projects project ON project.id=opportunity.project_id
    JOIN user_company_roles assignment ON assignment.id=opportunity.owner_assignment_id
   WHERE opportunity.owner_assignment_id IS NOT NULL AND assignment.company_id IS DISTINCT FROM project.company_id;
  IF cross_scope <> 0 THEN RAISE EXCEPTION 'U040 blocks owner FK validation: % cross-scope rows', cross_scope; END IF;
  SELECT count(*) INTO unresolved FROM support_sla_policies WHERE company_id IS NULL;
  IF unresolved <> 0 THEN RAISE EXCEPTION 'U040 blocks support policy validation: % unresolved rows', unresolved; END IF;
END $$;

ALTER TABLE product_families VALIDATE CONSTRAINT product_families_company_required_chk;
ALTER TABLE product_families ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE license_metrics ALTER COLUMN product_family_id SET NOT NULL;
ALTER TABLE renewal_opportunities VALIDATE CONSTRAINT renewal_opportunities_asset_id_fkey;

-- Validate only named deferred checks whose empty/legacy bridge is handled by U040.
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_budget_score_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_authority_score_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_need_score_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_timeline_score_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_technical_fit_score_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_score_total_bant_tf_range_chk;
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_revision_bant_tf_positive_chk;
ALTER TABLE engineer_certifications VALIDATE CONSTRAINT engineer_certifications_status_chk;
ALTER TABLE engineer_certifications VALIDATE CONSTRAINT engineer_certifications_revision_chk;
ALTER TABLE engineer_certifications VALIDATE CONSTRAINT engineer_certifications_lifecycle_chk;
ALTER TABLE engineer_certifications VALIDATE CONSTRAINT engineer_certifications_definition_id_fkey;
ALTER TABLE engineer_certifications VALIDATE CONSTRAINT engineer_certifications_engineer_membership_id_fkey;

-- Every U032-U039 deferred FK/check below has the same zero-orphan/null/cross-scope prerequisite
-- established above (or is empty on a legacy system).  Validation is deliberately explicit: no
-- constraint is silently treated as trusted merely because it was declared NOT VALID.
ALTER TABLE deal_qualifications VALIDATE CONSTRAINT deal_qualifications_assessed_by_assignment_id_fkey;
ALTER TABLE quotes VALIDATE CONSTRAINT quotes_content_hash_format_chk;
ALTER TABLE quote_commercial_snapshots VALIDATE CONSTRAINT quote_commercial_snapshots_snapshot_hash_format_chk;
ALTER TABLE quote_line_items VALIDATE CONSTRAINT quote_line_fulfillment_v1_complete_chk;
ALTER TABLE discount_requests VALIDATE CONSTRAINT discount_requests_quote_id_fkey;
ALTER TABLE vendor_request_events VALIDATE CONSTRAINT vendor_request_events_request_id_fkey;
ALTER TABLE discount_requests VALIDATE CONSTRAINT discount_requests_approval_request_id_fkey;
ALTER TABLE discount_requests VALIDATE CONSTRAINT discount_requests_requested_by_assignment_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_quote_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_discount_request_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_customer_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_requested_by_assignment_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_owner_assignment_id_fkey;
ALTER TABLE vendor_requests VALIDATE CONSTRAINT vendor_requests_submission_evidence_artifact_version_id_fkey;
ALTER TABLE vendor_request_events VALIDATE CONSTRAINT vendor_request_events_actor_assignment_id_fkey;
ALTER TABLE demo_licenses VALIDATE CONSTRAINT demo_licenses_vendor_request_id_fkey;
ALTER TABLE demo_licenses VALIDATE CONSTRAINT demo_licenses_product_sku_id_fkey;
ALTER TABLE demo_licenses VALIDATE CONSTRAINT demo_licenses_customer_id_fkey;
ALTER TABLE delivery_acceptances VALIDATE CONSTRAINT delivery_acceptances_engagement_id_fkey;
ALTER TABLE delivery_acceptances VALIDATE CONSTRAINT delivery_acceptances_quote_id_fkey;
ALTER TABLE delivery_acceptances VALIDATE CONSTRAINT delivery_acceptances_artifact_version_id_fkey;
ALTER TABLE delivery_acceptances VALIDATE CONSTRAINT delivery_acceptances_accepted_by_assignment_id_fkey;
ALTER TABLE customer_assets VALIDATE CONSTRAINT customer_assets_delivery_acceptance_id_fkey;
ALTER TABLE customer_assets VALIDATE CONSTRAINT customer_assets_source_quote_line_item_id_fkey;
ALTER TABLE customer_assets VALIDATE CONSTRAINT customer_assets_product_family_id_fkey;
ALTER TABLE customer_assets VALIDATE CONSTRAINT customer_assets_product_sku_id_fkey;
ALTER TABLE asset_licenses VALIDATE CONSTRAINT asset_licenses_delivery_acceptance_id_fkey;
ALTER TABLE asset_licenses VALIDATE CONSTRAINT asset_licenses_source_quote_line_item_id_fkey;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_delivery_acceptance_id_fkey;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_asset_license_id_fkey;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_source_quote_line_item_id_fkey;
ALTER TABLE renewal_opportunities VALIDATE CONSTRAINT renewal_opportunities_customer_id_fkey;
ALTER TABLE renewal_opportunities VALIDATE CONSTRAINT renewal_opportunities_subscription_id_fkey;
ALTER TABLE renewal_opportunities VALIDATE CONSTRAINT renewal_opportunities_opportunity_id_fkey;
ALTER TABLE renewal_opportunities VALIDATE CONSTRAINT renewal_opportunities_owner_assignment_id_fkey;
ALTER TABLE renewal_reminder_events VALIDATE CONSTRAINT renewal_reminder_events_renewal_opportunity_id_fkey;
ALTER TABLE renewal_reminder_events VALIDATE CONSTRAINT renewal_reminder_events_work_task_id_fkey;
ALTER TABLE renewal_reminder_events VALIDATE CONSTRAINT renewal_reminder_events_notification_event_id_fkey;
ALTER TABLE support_sla_policies VALIDATE CONSTRAINT support_sla_policies_company_required_chk;
ALTER TABLE support_sla_policies VALIDATE CONSTRAINT support_sla_policies_company_id_fkey;
ALTER TABLE support_sla_policies VALIDATE CONSTRAINT support_sla_policies_current_version_id_fkey;
ALTER TABLE support_sla_policy_versions VALIDATE CONSTRAINT support_sla_policy_versions_values_chk;
ALTER TABLE support_sla_policy_versions VALIDATE CONSTRAINT support_sla_policy_versions_company_id_fkey;
ALTER TABLE support_sla_policy_versions VALIDATE CONSTRAINT support_sla_policy_versions_policy_company_fkey;
ALTER TABLE support_cases VALIDATE CONSTRAINT support_cases_customer_id_fkey;
ALTER TABLE support_cases VALIDATE CONSTRAINT support_cases_asset_id_fkey;
ALTER TABLE support_cases VALIDATE CONSTRAINT support_cases_owner_assignment_id_fkey;
ALTER TABLE support_cases VALIDATE CONSTRAINT support_cases_rca_artifact_version_id_fkey;
ALTER TABLE support_case_sla_snapshots VALIDATE CONSTRAINT support_case_sla_snapshots_values_chk;
ALTER TABLE support_case_sla_snapshots VALIDATE CONSTRAINT support_case_sla_snapshots_support_case_id_fkey;
ALTER TABLE support_case_sla_snapshots VALIDATE CONSTRAINT support_case_sla_snapshots_policy_version_id_fkey;
ALTER TABLE vendor_escalations VALIDATE CONSTRAINT vendor_escalations_case_id_fkey;
ALTER TABLE vendor_escalations VALIDATE CONSTRAINT vendor_escalations_vendor_request_id_fkey;
ALTER TABLE vendor_escalations VALIDATE CONSTRAINT vendor_escalations_submission_evidence_artifact_version_id_fkey;
