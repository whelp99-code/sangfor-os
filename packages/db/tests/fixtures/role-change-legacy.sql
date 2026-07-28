-- U024's pre-migration fixture. The contract runner loads this only before U024 is deployed.
INSERT INTO "tenants" ("id", "name", "slug", "status") VALUES ('u024-tenant', 'U024 Legacy Tenant', 'u024-legacy-tenant', 'active');
INSERT INTO "companies" ("id", "tenant_id", "name", "slug") VALUES ('u024-company', 'u024-tenant', 'U024 Legacy Company', 'u024-legacy-company');
INSERT INTO "users" ("id", "email", "name", "updated_at") VALUES ('u024-legacy-user', 'legacy@u024.fixture.example.com', 'legacy user', now());
INSERT INTO "role_change_requests" ("id", "user_id", "from_role", "to_role", "status", "requested_by", "approved_by", "company_id") VALUES ('u024-legacy-role-change', 'u024-legacy-user', 'member', 'admin', 'pending', 'legacy-requester', 'legacy-approver', 'u024-company');
