# Open-Source CRM Evidence Matrix (BLRO)

**Task:** `opensource-crm-r2` / st_019ffb23  
**Method:** official docs + public repo source (read-only). No agents.  
**Observed:** 2026-08-13  
**Products:** Twenty, EspoCRM, SuiteCRM, Odoo CRM (CE), Erxes, Corteza (6th relevant OS CRM / low-code CRM platform)

Legend for capability cells:

| Mark | Meaning |
|---|---|
| **D** | Default UX / ships enabled in base product |
| **C** | Configurable (admin UI / metadata / modules) without forking core |
| **X** | Code/extension required (plugin, paid pack, Enterprise, custom object) |
| **G** | Gap for BLRO needs (not present or not source-proven) |
| **≠** | Docs claim ≠ code reality (called out) |

---

## 0. Release / SHA pins

| Product | Repo | Pin type | Tag / branch | Commit SHA (full) | Notes |
|---|---|---|---|---|---|
| **Twenty** | [twentyhq/twenty](https://github.com/twentyhq/twenty) | release tag | `twenty/v2.30.0` (2026-08-11) | `531361c9a73b5eda6223fc8deae7d5b3fe144fec` | Also observed `main` HEAD `659b18b3f8d0b85596d97a101d0fd7ea7086cb1e` (2026-08-13) |
| **EspoCRM** | [espocrm/espocrm](https://github.com/espocrm/espocrm) | release tag | `10.0.4` (2026-08-13) | `0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa` | Annotated tag object `da484c25312dc7bf2cd72d2decd01b463b4e4ef1`; `master` HEAD also `ff0cdb886705218a297b8949b0945a7251d55936` |
| **SuiteCRM** | [SuiteCRM/SuiteCRM](https://github.com/SuiteCRM/SuiteCRM) | release tag | `v7.15.2` (2026-07-31) | `d6bca97a0159ec019a969b86eca32affab3beb7c` | Default branch `hotfix` at same SHA |
| **Odoo CRM (CE)** | [odoo/odoo](https://github.com/odoo/odoo) | branch HEAD | `19.0` | `50298287733ce4ed8c5372495778e69cac5e114d` (2026-08-13) | No GitHub “latest release” on this monorepo; CE only |
| **Erxes** | [erxes/erxes](https://github.com/erxes/erxes) | release + HEAD | API reported `3.0.79` (2026-08-13) | `f734e808a1fd613b3ee68280009f9e1a59c0a136` | SHA is `main` HEAD at observation; tag→commit resolve later hit API rate limit — treat HEAD as working pin |
| **Corteza** | [cortezaproject/corteza](https://github.com/cortezaproject/corteza) | release branch HEAD | `2024.9.x` / release `2024.9.9` | `3b69e9f45140813d9a226e58e41f0c9317170d7d` | Commit message `v2024.9.9-hotfix.1` (2026-06-08) |

Immutable permalink pattern used below:

`https://github.com/{org}/{repo}/blob/{sha}/{path}`

---

## 1. Capability matrix (source-proven)

| Axis | Twenty `v2.30.0` / `531361c9…` | EspoCRM `10.0.4` / `0a50f3a3…` | SuiteCRM `v7.15.2` / `d6bca97a…` | Odoo CE `19.0` / `50298287…` | Erxes `f734e808…` | Corteza `3b69e9f4…` |
|---|---|---|---|---|---|---|
| **Object extensibility** | **D+C** Runtime workspace GraphQL schema builder; custom objects first-class | **C** Entity Manager + metadata (`entityDefs`/`scopes`); admin creates entity types | **C+X** ModuleBuilder + metadata; custom modules via code/ModuleInstall | **C+X** Python model inheritance + Studio (Studio often EE); CE = module code | **C+X** Plugin GraphQL subgraphs + properties meta; not single “custom object” admin like Espo | **D+C** Compose modules/fields as low-code data model |
| **Workflows / events** | **D** Full workflow engine: trigger → version → run → executor actions | **X (paid)** Workflows + BPM in **Advanced Pack** (not in OSS tree). Core has Formula/Webhooks/Hooks/Jobs | **D** AOW_WorkFlow in core; `after_save` logic hook | **D** `base_automation` + `ir.actions.server` (create/write/stage/cron…) | **D** Core automations service + per-plugin automation meta | **D** Automation workflows (`server/automation`) with graph exec + triggers |
| **Activities / tasks** | **D** `task`, `note`, `timeline-activity`, calendar objects | **D** CRM Task/Call/Meeting + Stream | **D** Activities, Calls, Meetings, Tasks, Notes, Cases | **D** Polymorphic `mail.activity` on any document | **D** Activity-log builders + inbox (frontline); not classic Task CRM everywhere | **C** Build activity modules in Compose; no CRM Task default |
| **Projects / service / renewal** | **G/X** No project/contract/subscription standard object — custom objects + workflows | **X** Project Mgmt / Subscriptions appear as **extensions** (Sales/other packs), not core OSS CRM module set | **D** `Project` + `AOS_Contracts` with **renewal_reminder_date → Call** | **Split** Project app **D** in CE. **Subscription lifecycle G in CE** (see §3). CRM has MRR *forecast* fields only | **G** No `renewal` paths in tree; sales/operation plugins exist but no renewal domain proven | **C/X** Model renewals as Compose modules + workflows; no CRM renewal pack |
| **APIs** | **D** Workspace GraphQL (dynamic schema) | **D** REST API + webhooks | **D** API v8 JSON:API (`Api/V8`) + legacy v4.1 | **D** JSON-RPC / XML-RPC external API | **D** GraphQL Federation gateway + tRPC plugin APIs | **D** REST (compose/automation/system) |
| **Permissions** | **D** Roles: object + field; **row-level = Premium/Organization** (docs) | **D** `AclManager` create/read/edit/delete/stream; field ACL; portal ACL | **D** ACLController + ACLRoles + Security Groups | **D** `ir.model.access` + `ir.rule` record rules (ORM-enforced) | **D** Permission groups/actions/scopes (`own`/`all`) per plugin meta | **D** First-class `server/pkg/rbac` rule index + workflow AC |
| **Audit** | **G/weak** No production audit module found (only test `audit-context.mock.ts`). TimelineActivity = UX feed, not compliance audit | **D** `ActionHistoryRecord` logger + Stream update notes + audit cleanup job | **D** `modules/Audit` field history (audited fields) | **Partial** Chatter/tracking on fields; accounting audit trails; not a universal CRM audit vault | **Partial** `activity-log` + logs service; no dedicated immutable audit entity named | **D-ish** `actionlog.Recorder` wired into automation/compose services |
| **AI implementation** | **D (code)** Agent entity, execution module, workflow `AiAgentActionModule`, agent↔role intersection. Docs still say AI Agent action “Coming soon” **≠** | **G** No AI agent runtime in core OSS | **G** No AI runtime in core | **Unproven in CE tree** Marketing/docs list AI; CE addon scan did not show Twenty-class agent module | **C** Automations AI agent utils (secret masking, worker queue); product AI knowledge hooks | **G** No native AI agent runtime |

---

## 2. Product deep evidence (not README)

### 2.1 Twenty — AI + workflow internals (verified)

**Workflow topology (code):**

- Root module imports trigger / status / core-sync only:  
  [`…/modules/workflow/workflow.module.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/workflow/workflow.module.ts)
- Trigger side: automated triggers + jobs + runner:  
  [`…/workflow-trigger/workflow-trigger.module.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/workflow/workflow-trigger/workflow-trigger.module.ts)
- Executor action registry (source of truth for what automation can do):  
  [`…/workflow-executor/workflow-executor.module.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/workflow/workflow-executor/workflow-executor.module.ts)  
  Imports include: `RecordCRUD`, `HttpRequest`, `Code`, `LogicFunction`, `Delay`, `Filter`, `IfElse`, `Iterator`, `Form`, `MailSender`, `CreateCalendarEvent`, **`AiAgentActionModule`**.
- Workflow is itself a workspace standard object with `DRAFT|ACTIVE|DEACTIVATED`:  
  [`…/workflow.workspace-entity.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/workflow/common/standard-objects/workflow.workspace-entity.ts)

**AI internals (code, not marketing):**

- Metadata AI package layout under `engine/metadata-modules/ai/`:  
  `ai-agent/`, `ai-agent-execution/`, `ai-agent-role/`, `ai-agent-monitor/`, `ai-chat/`, `ai-billing/`, `ai-models/`, `ai-generate-text/`.
- Agent persistence: name/label/prompt/`modelId`/responseFormat/evaluationInputs:  
  [`…/ai-agent/entities/agent.entity.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/engine/metadata-modules/ai/ai-agent/entities/agent.entity.ts)
- Execution module wires billing, models, **PermissionsModule**, roles, async executor:  
  [`…/ai-agent-execution.module.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/ai-agent-execution.module.ts)
- **Permission intersection for agents** (agent role ∩ optional run-as role):  
  [`…/build-agent-role-permission-config.util.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/utils/build-agent-role-permission-config.util.ts)
- Actor attribution source `FieldActorSource.AGENT` when building actor context:  
  [`…/agent-actor-context.service.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/agent-actor-context.service.ts)
- Workflow AI step module exists:  
  [`…/ai-agent/ai-agent-action.module.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent-action.module.ts)

**Docs (official):**

- Workflows overview (triggers: record/schedule/manual/webhook; actions list):  
  https://docs.twenty.com/user-guide/workflows/overview  
- Permissions (object/field; **row-level = Organization/Premium**):  
  repo doc [`…/permissions.mdx`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-docs/user-guide/permissions-access/capabilities/permissions.mdx)  
- AI agent role assignment:  
  [`…/permissions-access-control.mdx`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-docs/user-guide/ai/capabilities/permissions-access-control.mdx)

**Doc ≠ code:** workflows overview still labels **“AI Agent (Coming soon)”** while `AiAgentActionModule` is imported in executor. Treat AI-in-workflow as **implemented in server**, UX/docs maturity uncertain.

**Audit gap:** recursive tree search under `packages/twenty-server` for `audit` yielded essentially `test/utils/audit-context.mock.ts` only. Timeline feed:

[`…/timeline-activity.workspace-entity.ts`](https://github.com/twentyhq/twenty/blob/531361c9a73b5eda6223fc8deae7d5b3fe144fec/packages/twenty-server/src/modules/timeline/standard-objects/timeline-activity.workspace-entity.ts) — relational activity strip, not append-only compliance audit.

**Default vs configurable:**

| Concern | Default UX | Configurable |
|---|---|---|
| CRM objects | Company/Person/Opportunity/Task/Note | Custom objects + fields via workspace metadata |
| Automation | Workflows object in app nav | Triggers/actions per workspace |
| AI | Agents settings + chat (product surface) | Prompts, models, role assignment, workflow step |
| Row security | Off / plan-gated | Organization plan row predicates |
| Projects/renewals | Absent | Custom object + workflow only |

---

### 2.2 EspoCRM — core vs paid automation; ACL/audit

**Core OSS (in repo `10.0.4`):**

- Central ACL: create/read/edit/delete/stream checkers —  
  [`application/Espo/Core/AclManager.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Core/AclManager.php)
- Action history entity + logger (user, IP, auth token, target link):  
  [`…/Entities/ActionHistoryRecord.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Entities/ActionHistoryRecord.php)  
  [`…/DefaultActionLogger.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Core/Record/ActionHistory/DefaultActionLogger.php)
- Stream hooks on save/relate:  
  [`…/Hooks/Common/Stream.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Hooks/Common/Stream.php)
- Audit note cleanup (configurable retention; respects `preserveAuditLog` / stream):  
  [`…/Classes/Cleanup/Audit.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Classes/Cleanup/Audit.php)
- Formula evaluator (safe/unsafe modes) for scripted field logic:  
  [`…/Formula/Evaluator.php`](https://github.com/espocrm/espocrm/blob/0a50f3a37c8e2d96c0746a07ff698c9ef1c0c3aa/application/Espo/Core/Formula/Evaluator.php)
- Webhooks + scheduled jobs present in tree (core event egress).

**NOT in core tree:** no `Workflow`/`Bpmn` application modules in OSS blob listing (only CI workflow YAML). Official docs place **Workflows** and **BPM** under **Advanced Pack**:

- https://docs.espocrm.com/administration/workflows/
- https://docs.espocrm.com/administration/bpm/
- https://www.espocrm.com/extensions/advanced-pack/ — “Reports, Business Process Management, Workflows”

**Entity Manager / roles (docs, product admin):**

- https://docs.espocrm.com/administration/entity-manager/ — custom entities; **Preserve Audit Log** parameter
- https://docs.espocrm.com/administration/roles-management/ — baseline role, levels, field-level security, Audit permission

**Default vs configurable:**

| Concern | Default | Configurable | Paid/extra |
|---|---|---|---|
| Entities | Lead/Contact/Opportunity/Case/… | Entity Manager custom types | — |
| Automation | Formula, hooks, webhooks, jobs | Admin formulas/webhooks | **Advanced Pack** workflows/BPM |
| ACL/Audit | Roles + action history + stream | Field ACL, preserve audit | — |
| Projects/Subscriptions | Not core default CRM set | — | Extension packs (nav: Project Management, Subscriptions) |
| AI | None | — | G |

---

### 2.3 SuiteCRM — workflows, contracts renewal, ACL, audit, API

**Workflows in core OSS:**

- Module `AOW_WorkFlow` (status, flow_module, run_when, multiple_runs…):  
  [`modules/AOW_WorkFlow/AOW_WorkFlow.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/modules/AOW_WorkFlow/AOW_WorkFlow.php)
- Global after_save hook registration:  
  [`custom/Extension/application/Ext/LogicHooks/AOW_WorkFlow_Hook.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/custom/Extension/application/Ext/LogicHooks/AOW_WorkFlow_Hook.php)  
  → `AOW_WorkFlow::run_bean_flows`
- User docs: https://docs.suitecrm.com/user/advanced-modules/workflow/ (Process Audit section exists in docs nav)

**Contracts / renewal (actual code, not brochure):**

[`modules/AOS_Contracts/AOS_Contracts.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/modules/AOS_Contracts/AOS_Contracts.php)

- Computes `renewal_reminder_date` from `end_date` − `aos.contracts.renewalReminderPeriod`
- `save()` → `createReminder()` builds a **Call** (`parent_type = AOS_Contracts`, status Planned)
- This is **reminder UX**, not automated subscription billing/renewal opportunity generation

**Projects:** [`modules/Project/Project.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/modules/Project/Project.php) — first-class; relates accounts/contacts/opportunities.

**Permissions:**  
[`modules/ACL/ACLController.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/modules/ACL/ACLController.php) — `checkAccess`; admin bypass; Security Groups hooks; Calendar/Activities special cases.

**Audit:**  
[`modules/Audit/Audit.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/modules/Audit/Audit.php) — field history list with ACL gate on focus record.

**API:**  
[`Api/V8/Controller/ModuleController.php`](https://github.com/SuiteCRM/SuiteCRM/blob/d6bca97a0159ec019a969b86eca32affab3beb7c/Api/V8/Controller/ModuleController.php) CRUD; docs https://docs.suitecrm.com/developer/api/developer-setup-guide/json-api/

**AI:** none in module set. **Gap.**

**Default vs configurable:** classic Sugar module defaults; Studio/ModuleBuilder for fields/modules; workflows admin UI; Security Groups for row teaming.

---

### 2.4 Odoo CRM CE — subscriptions/renewals depth (critical)

#### What CE actually contains

**CRM app** [`addons/crm/__manifest__.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/crm/__manifest__.py) depends on mail/calendar/contacts — **not** subscriptions.

**Recurring revenue on opportunities (forecast only):**

[`addons/crm/models/crm_recurring_plan.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/crm/models/crm_recurring_plan.py) — plan name + `number_of_months`.

[`addons/crm/models/crm_lead.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/crm/models/crm_lead.py) fields:

- `recurring_revenue`, `recurring_plan`, `recurring_revenue_monthly` (MRR compute), prorated variants  
- Gated by `crm.group_use_recurring_revenues`  
- **No renewal state machine, no auto-invoice, no subscription period close/upsell**

**Automation (CE):**  
[`addons/base_automation`](https://github.com/odoo/odoo/tree/50298287733ce4ed8c5372495778e69cac5e114d/addons/base_automation) — triggers include `on_create`, `on_write`, `on_stage_set`, `on_tag_set`, time-based, etc. ([`base_automation.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/base_automation/models/base_automation.py)).

**Activities:**  
[`addons/mail/models/mail_activity.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/mail/models/mail_activity.py) — `res_model` + `res_id` polymorphic activities; `automated` flag.

**Projects (CE app):**  
[`addons/project/__manifest__.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/addons/project/__manifest__.py) — full project/task/milestone application.

**Permissions:**  
[`odoo/addons/base/models/ir_rule.py`](https://github.com/odoo/odoo/blob/50298287733ce4ed8c5372495778e69cac5e114d/odoo/addons/base/models/ir_rule.py) — record rules domain eval with `user`/`company_ids`; modes read/write/create/unlink.  
Official: https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html

#### Subscriptions / renewals — not in CE tree

- Recursive listing of `addons/*` on `19.0` HEAD showed **no** `sale_subscription` (or renewal) module; only mailing “subscription” opt-out.
- Official product docs for Subscriptions app (renew/upsell/close/auto pay):  
  https://www.odoo.com/documentation/19.0/applications/sales/subscriptions.html  
  https://www.odoo.com/app/subscriptions  
- Private `odoo/enterprise` not publicly cloneable; **CE pin cannot source-prove subscription lifecycle code**.

| Odoo concept | CE proven? | Nature |
|---|---|---|
| Opportunity MRR forecast | Yes | Sales pipeline metric |
| Project delivery | Yes | Separate app; linkable via `sale_project` etc. |
| Subscription billing & renewal ops | **No in CE** | Enterprise/docs product |
| Helpdesk-style service | Not fully inventoried here | Often EE skew |

**BLRO implication:** Do not cite “Odoo open-source has renewals” — CE has **project + MRR fields + automation**; true renewals need EE Subscriptions or custom modules.

---

### 2.5 Erxes — plugin isolation + AI + permissions

**Plugin process model (isolation boundary):**

- Shared starter boots each plugin as its own Express/Apollo **subgraph** with meta for automations/permissions/logs:  
  [`backend/erxes-api-shared/src/utils/start-plugin.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/erxes-api-shared/src/utils/start-plugin.ts)
- In-repo plugins (separate deployables):  
  `accounting_api`, `content_api`, `frontline_api`, `insurance_api`, `loyalty_api`, `mongolian_api`, `operation_api`, `payment_api`, `posclient_api`, `sales_api`, `tourism_api`
- Service discovery / enablement via env + Redis active plugin set:  
  [`…/service-discovery` utils](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/erxes-api-shared/src/utils/service-discovery.ts) — `ENABLED_PLUGINS`, `getActivePlugins`, SaaS charge gating
- Gateway dynamically loads downloaded plugin subscription configs:  
  [`backend/gateway/src/subscription/plugins/getPluginConfigs.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/gateway/src/subscription/plugins/getPluginConfigs.ts)

**What “isolation” is and is not:**

| Isolated | Shared / weak boundary |
|---|---|
| Separate Node process & port per plugin API | Redis, message queue, Mongo connection patterns from env |
| GraphQL subgraph schema ownership | Gateway composes federation — bad plugin can still publish wide schema if allowed to join |
| Per-plugin `meta/permissions.ts` | Permission evaluation can call core via tRPC (`sendTRPCMessage`) |
| UI Module Federation packages | Host core-ui loads remote modules — not OS-level sandbox |

**Not proven:** multi-tenant DB schema isolation per plugin; capability sandbox denying cross-plugin Mongo access. **Anti-pattern risk:** plugin isolation = microservice packaging, not capability security.

**Permissions:**

- Core contacts example scopes `own`/`all` + CRUD action names:  
  [`backend/core-api/src/meta/permissions.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/core-api/src/meta/permissions.ts)
- Runtime action map from permission groups + Redis cache:  
  [`…/permissions/utils.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/erxes-api-shared/src/core-modules/permissions/utils.ts)

**Automations + AI:**

- Core automation init (set property, AI knowledge batch for products):  
  [`backend/core-api/src/meta/automations/automations.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/core-api/src/meta/automations/automations.ts)
- AI agent mutation secret masking / merge:  
  [`…/automations/graphql/resolvers/utils/aiAgent.ts`](https://github.com/erxes/erxes/blob/f734e808a1fd613b3ee68280009f9e1a59c0a136/backend/core-api/src/modules/automations/graphql/resolvers/utils/aiAgent.ts)

**Audit:** activity-log builders under contacts/products/clientportal + `modules/logs` — event/activity oriented; **no** Espo-style ActionHistory or Suite field audit module found (`audit` path count = 0).

**Renewal:** path search `renewal` = **0**. Gap.

Docs entry: https://erxes.io/docs (architecture: gateway + plugins + Module Federation).

---

### 2.6 Corteza (6th OS CRM-relevant platform)

Why included: low-code **Compose** data apps + workflow engine + strong RBAC — closest OSS pattern to “customer context objects without forced pipeline product.”

Evidence:

- Compose module service (create/update modules as data model):  
  [`server/compose/service/module.go`](https://github.com/cortezaproject/corteza/blob/3b69e9f45140813d9a226e58e41f0c9317170d7d/server/compose/service/module.go)
- Workflow service with `runAs`, graph cache, RBAC exec checks:  
  [`server/automation/service/workflow.go`](https://github.com/cortezaproject/corteza/blob/3b69e9f45140813d9a226e58e41f0c9317170d7d/server/automation/service/workflow.go)
- RBAC service (rule index, roles, org tree):  
  [`server/pkg/rbac/service.go`](https://github.com/cortezaproject/corteza/blob/3b69e9f45140813d9a226e58e41f0c9317170d7d/server/pkg/rbac/service.go)
- Docs:  
  - Security model: https://docs.cortezaproject.org/corteza-docs/2024.9/integrator-guide/security-model/index.html  
  - Workflows: https://docs.cortezaproject.org/corteza-docs/2024.9/integrator-guide/automation/workflows/index.html  
  - Compose: https://docs.cortezaproject.org/corteza-docs/2024.9/integrator-guide/compose-configuration/index.html

**Gap:** not a packaged CRM (no default Opportunity/Renewal). **AI:** none native. Value is **pattern**, not drop-in CRM.

---

## 3. Cross-cut: permissions & audit (each product)

| Product | Enforcement layer | Row/record scope | Field scope | Audit artifact | Retention / integrity notes |
|---|---|---|---|---|---|
| Twenty | Role flags + object/field maps; agent uses role **intersection** | Row-level **Premium** (docs) | Yes (docs + metadata modules) | TimelineActivity feed; **no** dedicated audit store found | Soft-delete common; not WORM |
| EspoCRM | `AclManager` + ownership/team/portal checkers | own/team/all levels (roles docs) | Field-level security (docs + entityAcl) | ActionHistoryRecord + Stream update notes | Cleanup job deletes old audit notes unless `preserveAuditLog` |
| SuiteCRM | ACLAction + Security Groups | owner / group | Limited vs Espo; module/action centric | `modules/Audit` field history | Classic Sugar audit tables |
| Odoo CE | ACL + `ir.rule` domains in ORM | Record rules global vs group | `ir.model.fields` groups / invisible | Tracking + chatter; account audit apps | Rules can be sudo-bypassed if code misuses `sudo()` (docs warn) |
| Erxes | Action map from permission groups | `own` vs `all` scopes in meta | Not as rich as Espo field ACL in sampled core | activity-log builders + logs service | Redis-cached permission map — invalidate on group change |
| Corteza | `pkg/rbac` allow/deny rules | Resource-level + contextual roles | Via module field perms in compose UI | `actionlog.Recorder` | Strong model; CRM semantics DIY |

---

## 4. BLRO patterns & anti-patterns

Context: BLRO wants **customer/context-centric work** (deal, project, PoC, support, renewal) with **AI staff + human staff**, guardrails without making stage the only door.

### Patterns to copy

1. **Object-first, pipeline-optional (Twenty, Corteza, Espo Entity Manager)**  
   Model Project/PoC/Renewal as peers linked to Customer — not only child tabs of Deal. Twenty/Corteza make this the architecture; Espo Entity Manager approximates via admin entities.

2. **Event/automation bus with explicit run records (Twenty WorkflowRun, Erxes Executions, Corteza sessions, Odoo automation)**  
   Keep automations as data (versioned definitions + run history), not hidden stage buttons.

3. **AI as principal with role intersection (Twenty)**  
   `buildAgentRolePermissionConfig` + `FieldActorSource.AGENT` is the right shape for “AI employee”: identity, role, attribution. BLRO should not run domain AI as anonymous superuser.

4. **Polymorphic activities (Odoo `mail.activity`, Espo Stream, Twenty Task targets)**  
   One activity system across customer-linked objects beats per-stage task panels.

5. **Contract renewal as first-class date + reminder (SuiteCRM AOS_Contracts)**  
   Even if billing is elsewhere, **end_date → reminder activity** is the minimal renewal primitive BLRO still lacks in UX.

6. **ORM/record-rule enforcement (Odoo ir.rule, Espo ACL on select)**  
   Permissions that only live in UI routers will be bypassed by API/AI tools.

7. **Plugin packaging for bounded domains (Erxes)**  
   Sales vs frontline vs operations as deployables is good **team/bounded-context** hygiene — if paired with real authz on every resolver.

### Anti-patterns to avoid

1. **Stage gate as sole API for side effects (BLRO current risk; also Sugar-style “only after save on Opportunity” culture)**  
   Suite AOW on `after_save` is powerful but encourages “change stage to trigger world.” Prefer explicit commands/events.

2. **README-level AI claims without agent permission model (prior shallow compare failure)**  
   Erxes/Twenty marketing ≠ safe AI ops. Require role-scoped tools + audit of tool calls.

3. **Confusing CE forecast MRR with subscription renewal (Odoo)**  
   `crm.recurring.plan` is not renewal ops. Buying EE later is a product fork.

4. **Paid pack assumed free (Espo Advanced Pack workflows/BPM)**  
   Core Espo without Advanced Pack ≠ HubSpot-like workflow builder.

5. **Microservice plugin = security isolation (Erxes)**  
   Process split without data-plane isolation still allows cross-collection access if Mongo credentials are shared.

6. **Timeline/chatter as compliance audit (Twenty/Odoo default UX)**  
   Feeds are UX. BLRO needs immutable action log (who/what/before/after) for AI+human.

7. **Row-level security behind premium skus if multi-partner data coexists (Twenty)**  
   Partner OS multi-tenant instincts need RLS from day one, not plan upsell.

8. **Building renewals only as Deal stage (BLRO + any pipeline CRM)**  
   Suite contracts and Odoo EE subscriptions both treat renewal as its own lifecycle; BLRO renewals page without create path repeats the anti-pattern.

---

## 5. BLRO-oriented recommendation (evidence-based, not vendor pick)

| BLRO need | Best OSS reference | Do not cargo-cult |
|---|---|---|
| Flexible objects around Customer | Twenty workspace objects / Corteza Compose / Espo EM | Suite hard modules without ModuleBuilder discipline |
| Independent Project / PoC / Support entry | Odoo project app independence; Espo Case; Suite Project | Twenty out-of-box (must configure) |
| Renewal lifecycle | Suite contract reminder primitive; Odoo **EE** subscriptions conceptually | Odoo CE MRR fields alone |
| Workflow without stage tyranny | Twenty triggers (record/schedule/manual/webhook); Corteza; Odoo base_automation | Only-on-stage-change designs |
| AI employees | Twenty agent entity + role intersection + actor source | Bolting LLM on controllers without authz |
| Audit for AI+human | Espo ActionHistory + Stream; Suite Audit; Corteza actionlog | Twenty timeline-only |
| Extensibility isolation | Erxes plugin processes **plus** hard authz; Espo metadata modules | Unreviewable shared-DB plugins |

**Practical composite for SANGFOR Partner OS direction:**

- **Kernel:** customer-context graph + polymorphic WorkTask/Activity (you already have seeds of this).  
- **Automation:** versioned workflows with run history (Twenty-like), not only stage buttons.  
- **AI:** named agents with role intersection + actor attribution (Twenty code pattern).  
- **Renewal:** first-class object with end_date and projection (Suite reminder + your projection job, but fix hardcoded amounts).  
- **Authz/Audit:** ORM-level rules (Odoo/Espo) + append-only action log (Espo/Suite) before expanding AI write tools.

---

## 6. Explicit gaps / unverified

| Claim | Status |
|---|---|
| Twenty end-to-end AI chat UX parity with agent entity | Code exists; full UX path not runtime-tested here |
| Twenty row-level permission implementation details | Docs + migrations/types observed; not behavior-tested |
| Espo Advanced Pack source | Paid; not in public `espocrm/espocrm` tree |
| Odoo EE `sale_subscription` code | Private enterprise; docs-only |
| Erxes per-tenant Mongo DB isolation | Not proven; env suggests shared infra patterns |
| Corteza 2024.9.9 tag→commit via API | Branch HEAD `3b69e9f4…` used; release API rate-limited mid-run |
| Erxes tag `3.0.79` commit resolve | HEAD `f734e808…` used after rate limit |
| SuiteCRM 8.x | Not evaluated (pin is 7.15.2 AGPL line) |

---

## 7. Source inspection log (≥12)

1. GitHub API: default branches + HEAD SHAs — twenty, espocrm, SuiteCRM, odoo, erxes, corteza  
2. GitHub API: latest/release tags — twenty `twenty/v2.30.0`, espo `10.0.4`, Suite `v7.15.2`, erxes `3.0.79`, corteza `2024.9.9`  
3. Twenty recursive git tree — workflow/ai/permission/audit/activity paths  
4. Twenty raw: `workflow-executor.module.ts`, `workflow-trigger.module.ts`, `agent.entity.ts`, `ai-agent-execution.module.ts`, `build-agent-role-permission-config.util.ts`, `agent-actor-context.service.ts`, `ai-agent-action.module.ts`, permissions + AI docs mdx  
5. Espo recursive tree — Acl/Audit/Stream/Formula/Webhook; raw AclManager, ActionHistory, Audit cleanup, Formula, Stream hook, DefaultActionLogger  
6. Espo official docs — workflows, BPM, roles, entity manager, Advanced Pack page  
7. Suite recursive modules list; raw AOW_WorkFlow, AOS_Contracts, Audit, ACLController, Project, Api V8 ModuleController, AOW hook  
8. Suite docs — workflow user guide, JSON API guide  
9. Odoo recursive addons filter; raw crm_recurring_plan, crm manifest, crm_lead recurring fields, base_automation, ir_rule, mail_activity, project manifest  
10. Odoo docs — subscriptions, CRM, security, project  
11. Erxes recursive tree; raw start-plugin, permissions meta/utils, automations, aiAgent utils, service-discovery, getPluginConfigs; plugin directory listing  
12. Erxes docs — https://erxes.io/docs architecture  
13. Corteza raw rbac service, automation workflow service, compose module service, README; docs security/workflows/compose  
14. Twenty timeline-activity entity; release commit resolve for `twenty/v2.30.0` → `531361c9…`  
15. Cross-check: Odoo CE addon names lack `sale_subscription`; apps.odoo.com 19.0 module page 404 for public fetch

---

## EXPAND

Deferred only if product decisions need more:

1. Runtime proof of Twenty AI workflow step against a live workspace (code says yes, docs say coming soon).  
2. Espo Advanced Pack license boundary vs Sales Pack (Projects/Subscriptions) SKU matrix.  
3. Odoo EE `sale_subscription` renewal state machine from enterprise tarball if license allows.  
4. Erxes Mongo connection-per-plugin audit (security review).  
5. SuiteCRM 8.x Symfony line vs 7.15.2 for API/auth modernisation.  
6. Twenty field-level permission enforcement path in GraphQL query runner (beyond docs).

**STOP:** matrix is source-proven for requested axes; paid/EE and rate-limited tag edges explicitly marked.
