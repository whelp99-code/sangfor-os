DROP POLICY IF EXISTS "sangfor_scope_vendor_requests" ON "vendor_requests";

CREATE POLICY "sangfor_scope_vendor_requests" ON "vendor_requests"
FOR ALL TO sangfor_app
USING (
  EXISTS (
    SELECT 1
    FROM "customers" AS scope_customer
    JOIN "projects" AS scope_project ON scope_project."id" = scope_customer."project_id"
    JOIN "companies" AS scope_company ON scope_company."id" = scope_project."company_id"
    WHERE scope_customer."id" = "vendor_requests"."customer_id"
      AND scope_project."id" = current_setting('app.project_id', true)
      AND scope_project."company_id" = current_setting('app.company_id', true)
      AND scope_company."tenant_id" = current_setting('app.tenant_id', true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "customers" AS scope_customer
    JOIN "projects" AS scope_project ON scope_project."id" = scope_customer."project_id"
    JOIN "companies" AS scope_company ON scope_company."id" = scope_project."company_id"
    WHERE scope_customer."id" = "vendor_requests"."customer_id"
      AND scope_project."id" = current_setting('app.project_id', true)
      AND scope_project."company_id" = current_setting('app.company_id', true)
      AND scope_company."tenant_id" = current_setting('app.tenant_id', true)
  )
);
