DROP POLICY IF EXISTS "sangfor_scope_sizing_templates" ON "sizing_templates";

CREATE POLICY "sangfor_scope_sizing_templates" ON "sizing_templates"
FOR ALL TO sangfor_app
USING (
  EXISTS (
    SELECT 1
    FROM "product_families" AS scope_family
    JOIN "companies" AS scope_company ON scope_company."id" = scope_family."company_id"
    WHERE scope_family."id" = "sizing_templates"."product_family_id"
      AND scope_family."company_id" = current_setting('app.company_id', true)
      AND scope_company."tenant_id" = current_setting('app.tenant_id', true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "product_families" AS scope_family
    JOIN "companies" AS scope_company ON scope_company."id" = scope_family."company_id"
    WHERE scope_family."id" = "sizing_templates"."product_family_id"
      AND scope_family."company_id" = current_setting('app.company_id', true)
      AND scope_company."tenant_id" = current_setting('app.tenant_id', true)
  )
);
