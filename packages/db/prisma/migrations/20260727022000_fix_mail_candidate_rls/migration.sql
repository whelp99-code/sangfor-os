DROP POLICY IF EXISTS "sangfor_scope_mail_derived_candidates" ON "mail_derived_candidates";

CREATE POLICY "sangfor_scope_mail_derived_candidates"
ON "mail_derived_candidates"
FOR ALL
TO "sangfor_app"
USING (
  EXISTS (
    SELECT 1
    FROM "mail_insight_threads" thread
    JOIN "projects" project ON project."id" = thread."project_id"
    JOIN "companies" company ON company."id" = project."company_id"
    WHERE thread."id" = "mail_derived_candidates"."mail_insight_thread_id"
      AND project."id" = current_setting('app.project_id', true)
      AND project."company_id" = current_setting('app.company_id', true)
      AND company."tenant_id" = current_setting('app.tenant_id', true)
  )
  OR EXISTS (
    SELECT 1
    FROM "knowledge_documents" document
    JOIN "projects" project ON project."id" = document."project_id"
    JOIN "companies" company ON company."id" = project."company_id"
    WHERE document."id" = "mail_derived_candidates"."knowledge_document_id"
      AND project."id" = current_setting('app.project_id', true)
      AND project."company_id" = current_setting('app.company_id', true)
      AND company."tenant_id" = current_setting('app.tenant_id', true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "mail_insight_threads" thread
    JOIN "projects" project ON project."id" = thread."project_id"
    JOIN "companies" company ON company."id" = project."company_id"
    WHERE thread."id" = "mail_derived_candidates"."mail_insight_thread_id"
      AND project."id" = current_setting('app.project_id', true)
      AND project."company_id" = current_setting('app.company_id', true)
      AND company."tenant_id" = current_setting('app.tenant_id', true)
  )
  OR EXISTS (
    SELECT 1
    FROM "knowledge_documents" document
    JOIN "projects" project ON project."id" = document."project_id"
    JOIN "companies" company ON company."id" = project."company_id"
    WHERE document."id" = "mail_derived_candidates"."knowledge_document_id"
      AND project."id" = current_setting('app.project_id', true)
      AND project."company_id" = current_setting('app.company_id', true)
      AND company."tenant_id" = current_setting('app.tenant_id', true)
  )
);
