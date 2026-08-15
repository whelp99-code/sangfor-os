# Commercial CRM Comparison Matrix (BLRO / SANGFOR Partner OS)

**As-of:** 2026-08-13  
**Scope:** Salesforce, HubSpot, Microsoft Dynamics 365, Zoho CRM, Pipedrive (5th commercial CRM)  
**Method:** Official product pages, developer docs, Microsoft Learn, vendor knowledge bases, vendor `llms.txt` where available. Read-only web research.  
**Purpose:** Source-backed lessons for BLRO AI-native CRM redefinition — what to **copy**, what to **reject**, and what is **marketing vs documented behavior**.

---

## 0. Research limitations (counter-search)

| Barrier | Impact | Mitigation used |
|---|---|---|
| Salesforce Help / many `help.salesforce.com` pages | SPA “CSS Error / Loading” shell; little extractable body | Product pages, pricing feature matrices, Trailhead shells, `https://www.salesforce.com/llms.txt`, Agentforce marketing+FAQ |
| Salesforce Developer docs (`developer.salesforce.com/docs/...`) | Often blocked/error stub (~2.4KB) | Relied on product/pricing claims + platform marketing; **do not treat as full platform object-model proof** |
| Zoho Help portal articles | Many returned empty/login shells (~33KB with no body) | Product marketing pages (features, Blueprint, Zia, pricing, customization) + DDG official-index snippets pointing to help URLs |
| Some HubSpot KB paths | 404 on guessed slugs (tasks/approvals/projects/perms) | Working KB: custom objects, pipelines, associations, workflows; developer CRM + Pipelines APIs |
| DuckDuckGo HTML search | Bot challenge on later queries | First Zoho query returned useful official URL index before challenge |

**Labeling convention in matrix**

- **DOC** = documented product/developer/help behavior with operational detail  
- **MKT** = marketing claim; capability directionally true but depth/limits not fully verified in this pass  
- **MIX** = mixture; core capability DOC, breadth/autonomy claims MKT  

---

## 1. Executive matrix (one-screen)

| Dimension | Salesforce | HubSpot | Microsoft Dynamics 365 | Zoho CRM | Pipedrive |
|---|---|---|---|---|---|
| **Object / custom object model** | MIX — Customer 360 objects + deep platform customization (metadata-driven); custom objects widely claimed; **dev object reference not verified this pass** | **DOC** — rich object catalog + Enterprise custom objects + associations API | **DOC** — Dataverse tables (standard + custom), relationships, ownership | **DOC/MIX** — modules + custom modules/fields/layouts; Team modules | **DOC** — fixed core entities (deal/person/org/lead/product/project) + custom **fields** (not freeform objects) |
| **Pipeline flexibility** | MIX — multiple sales processes / pipeline mgmt by edition; Path/process automation ecosystem | **DOC** — multi-pipeline per object (deals, tickets, custom objects, leads…); stage rules/automation/approvals | **DOC** — Opportunity stages + Business Process Flows; Project Ops multi-entity sales process | **DOC** — pipelines + **Blueprint** stage enforcement | **DOC** — multiple visual pipelines/stages; activity-based selling focus |
| **Activities / work** | MIX — Activity Management, Einstein Activity Capture, tasks/events | **DOC** — engagements (email/call/meeting/note/task) associated to records | **DOC** — activities on opportunities; tasks; CS cases | MIX — tasks/calls/meetings/cadences (product) | **DOC** — first-class Activities; API for activities/tasks |
| **Projects / service / renewal independence** | MIX — Service Cloud / Field Service / RLM separate but on same platform; not forced through one deal stage | **DOC** — Tickets, Services, Subscriptions, Projects (0-970), separate deal pipelines (e.g. renewals) | **DOC** — Sales vs Customer Service vs Project Operations as related but independent apps/entities | MIX — CRM + Zoho Projects ecosystem; support channels in bundles; not single forced path | **DOC** — Projects linked to deals but delivery board is separate; can link project↔deal |
| **Automation** | MIX — Flow / workflow / process automation; Agentforce actions reuse Flows | **DOC** — Workflows (filter/event/schedule/webhook), AI-assisted build | **DOC** — Power Automate cloud flows + Dataverse; Approvals connector | **DOC** — Workflows, Cadences, Blueprint actions, custom functions | **DOC** — trigger/action automations (event + date); Growth+ |
| **AI agents / copilots** | **MIX** — Agentforce platform (builders, guardrails, observability, multi-agent); strong productization | **MIX** — Agent Hub / Breeze agents (prospecting, customer, data) grounded in CRM | **MIX** — Copilot in D365 Sales + Sales agents (Qualification/Opportunity/Close/Research) + Copilot Studio | **MIX** — Zia + AI Agents for Sales + GenAI setup | **MIX** — AI Sales Assistant, email AI, report NL; narrower agent surface |
| **Natural-language creation / actions** | MIX — Agent Builder NL instructions; employee agents; conversational UI claims | **DOC** — workflow “With AI”; Breeze Assistant; custom object via Copilot claim in KB | **DOC** — Copilot NL chat; Dataverse “Start with Copilot” table gen; PA Copilot flow build | **DOC** — Zia GenAI creates modules/workflows/reports; voice prompts; query data | **DOC** — NL report gen; NL marketplace search; assistant prompts |
| **Approval / permissions / audit** | MIX — Approval processes (Trailhead); platform security; Einstein Trust Layer audit trail for AI | MIX — pipeline rules can require approval; user permissions; enterprise limits | **DOC** — RBAC, BU, sharing, column security, Dataverse auditing, PA Approvals | MIX — profiles/roles/sharing (help thin this pass); Blueprint as process control | **DOC** — permission sets vs visibility groups; Security center/audit logs (product) |

---

## 2. Dimension detail (cited)

### 2.1 Object / custom object model

| Vendor | Documented behavior | Sources | MKT caution |
|---|---|---|---|
| **Salesforce** | Sales Cloud editions include Account, Contact, Lead, Opportunity management; higher editions add customization/API. Platform marketed as metadata + Customer 360 + Data 360. | [Sales pricing](https://www.salesforce.com/products/sales-cloud/pricing/), [Sales features](https://www.salesforce.com/products/sales-cloud/features/), [Headless 360 platform](https://www.salesforce.com/platform/) | Full custom-object limits, relationship types, and sharing model **not** verified from developer object reference (blocked). |
| **HubSpot** | CRM = objects → records → properties; associations; engagements. Large built-in catalog including Contacts, Companies, Deals, Tickets, Leads, Quotes, Orders, Subscriptions, Services, **Projects (0-970)**, Tasks, etc. **Custom objects** (`2-XXX`) via schemas API / Data Model UI (Enterprise hubs). Associations can be labeled; activities pinable on custom objects. | [Understanding CRM APIs](https://developers.hubspot.com/docs/api/crm/understanding-the-crm), [Custom object records API](https://developers.hubspot.com/docs/api/crm/crm-custom-objects), [Create custom objects KB](https://knowledge.hubspot.com/object-settings/create-custom-objects) (updated 2026-06-12) | Custom objects are **not** free-tier; KB warns against abusing custom objects to clone Contacts or replace activities. |
| **Microsoft D365** | Dataverse tables: standard + custom; ownership (user/team/org); relationships; virtual/elastic table types; **Start with Copilot** natural-language table design. D365 Sales runs on Dataverse model-driven apps. | [Create/edit tables](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities-portal), [D365 Sales overview](https://learn.microsoft.com/en-us/dynamics365/sales/overview) | “Unlimited modeling” still constrained by security roles, solution ALM, and app UX design cost. |
| **Zoho CRM** | Module-centric model (Leads/Accounts/Contacts/Deals etc.); **custom modules**, custom fields, layouts, Canvas UI; **Team modules** vs org modules with different license/capability boundaries. | [Customization](https://www.zoho.com/crm/customization.html), [Features](https://www.zoho.com/crm/features.html), pricing module language on [pricing](https://www.zoho.com/crm/pricing.html); help index via DDG → `Creating Custom Modules` on help.zoho.com | Deep module limits/API shapes partially blocked; Team user restrictions are real product complexity. |
| **Pipedrive** | Core entities: Deals, Leads, Persons, Organizations, Products, Activities, **Projects** (boards/phases/tasks). Extensibility is primarily **custom fields** per entity (not arbitrary new object types). Open REST API covers these entities. | [Custom fields KB](https://support.pipedrive.com/en/article/custom-fields) (updated 2026-07-24), [API reference](https://developers.pipedrive.com/docs/api/v1), [llms.txt](https://www.pipedrive.com/llms.txt) | Do not equate Pipedrive with Salesforce/HubSpot-style custom object platforms. |

**BLRO note:** HubSpot/Dataverse/Zoho show that **customer context is a graph of typed objects**, not a single deal record with bolted panels. Pipedrive shows a viable simpler model if scope stays sales+delivery.

---

### 2.2 Pipeline flexibility

| Vendor | Documented behavior | Sources | MKT caution |
|---|---|---|---|
| **Salesforce** | Pipeline Management + customizable sales process listed on Sales Cloud; Advanced Pipeline on Enterprise+. Workflow/process automation and quoting/approvals marketed. | [Sales features](https://www.salesforce.com/products/sales-cloud/features/), [Sales pricing matrix](https://www.salesforce.com/products/sales-cloud/pricing/) | Exact multi-pipeline / path assistant configuration steps not extracted from Help SPA. |
| **HubSpot** | Pipelines = stages for process visualization. Objects with pipelines: Deals, Tickets, Leads (Pro+), Custom objects (Enterprise), Appointments, Courses, Listings, Orders, Projects, Services, Tasks (single default). Multiple pipelines when processes differ; team-restricted pipelines Pro+. Pipeline rules, automations, conditional stage properties, **require approval**. Stage limits: deals/tickets/custom up to 100 stages. Explicit example: separate pipeline for **Contract Renewals**. | [Set up pipelines KB](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines) (updated 2026-08-12), [Pipelines API](https://developers.hubspot.com/docs/api/crm/pipelines) | Separate pipelines only when stages truly differ — KB discourages brand-only pipeline splits. |
| **Microsoft D365** | Opportunities move through stages (Qualify → Develop → Propose → Close in default guidance). Business process flows guide stages; can span **different tables** (Opportunity → Quote → Project Contract) in Project Operations. Conditional BPF stages. Kanban/view options exist in product family (some URLs 404 this pass). | [Create/edit opportunities](https://learn.microsoft.com/en-us/dynamics365/sales/create-edit-opportunity-sales) (updated 2026-07-07), [Project Ops sales process](https://learn.microsoft.com/en-us/dynamics365/project-operations/sales/sales-overview) (updated 2026-02-28) | BPF is guidance + gating when configured — not automatically the only way to create related work unless you build it that way. |
| **Zoho CRM** | Sales pipeline management + **Blueprint**: visual process, per-stage mandatory checks, automations, SLA-ish “don’t sit unattended,” bottleneck reports. Blueprint from Professional upward (help FAQ via search index). | [Blueprint product](https://www.zoho.com/crm/blueprint.html), [SFA](https://www.zoho.com/crm/sales-force-automation.html), [Features](https://www.zoho.com/crm/features.html) | Blueprint is **optional process enforcement**, not proof that all Zoho work is stage-gated. |
| **Pipedrive** | Visual drag-drop pipelines and stages; multiple pipelines; deal rotting; pipeline visibility controls. Philosophy: activity-based selling over pure stage theater. | [Features](https://www.pipedrive.com/en/features), [llms.txt](https://www.pipedrive.com/llms.txt), [Visibility groups](https://support.pipedrive.com/en/article/visibility-groups) | Strong sales-pipeline product; weaker generic multi-object pipeline engine than HubSpot. |

**BLRO note:** Every serious CRM treats pipeline as **one visualization of a process on an object**, and supports **multiple processes** (new logo vs renewal vs service). None require “all company work” to share one deal stage machine.

---

### 2.3 Activities / work

| Vendor | Documented behavior | Sources |
|---|---|---|
| **Salesforce** | Activity Management: capture emails/events/engagement on leads/contacts/accounts/opportunities; task management in edition matrix; Einstein Activity Capture on higher AI features. | [Sales features](https://www.salesforce.com/products/sales-cloud/features/), [Sales pricing](https://www.salesforce.com/products/sales-cloud/pricing/) |
| **HubSpot** | Engagements/activities: calls, emails, meetings, notes, tasks, communications, postal mail — associated to records; timeline; associations API. KB warns: **do not replace activities with a custom Notes object**. | [CRM APIs](https://developers.hubspot.com/docs/api/crm/understanding-the-crm), [Custom objects KB](https://knowledge.hubspot.com/object-settings/create-custom-objects), [Associate records](https://knowledge.hubspot.com/records/associate-records) |
| **Microsoft D365** | Activities/notes on opportunities; meeting prep; email assist via Copilot; Customer Service cases as work items; Project tasks in Project Operations world. | [Copilot overview](https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview), [Customer Service](https://learn.microsoft.com/en-us/dynamics365/customer-service/overview), [Create opportunity](https://learn.microsoft.com/en-us/dynamics365/sales/create-edit-opportunity-sales) |
| **Zoho CRM** | Tasks, calls, meetings, cadences, follow-ups as SFA automation surface; activities automated via workflows. | [Features](https://www.zoho.com/crm/features.html), [SFA](https://www.zoho.com/crm/sales-force-automation.html) |
| **Pipedrive** | Activities are core (calls/meetings/tasks); automations on activity add/update/delete; project activities separate permission. | [Automations KB](https://support.pipedrive.com/en/article/workflow-automation), [Permission sets](https://support.pipedrive.com/en/article/permission-sets), [API Activities](https://developers.pipedrive.com/docs/api/v1) |

**BLRO note:** Work is a **first-class activity stream on many objects**, not only a checklist locked inside a deal stage tab.

---

### 2.4 Projects / service / renewal independence

| Vendor | Documented behavior | Sources | Independence pattern |
|---|---|---|---|
| **Salesforce** | Distinct clouds/products: Sales, Service (cases, field service, asset lifecycle), employee service; Revenue Lifecycle Management marketed separately. Agents for service vs sales. | [Agentforce Service](https://www.salesforce.com/service/), [Agentforce](https://www.salesforce.com/agentforce/), [CRM overview](https://www.salesforce.com/crm/) | **Same platform, different objects/apps** — service case does not require opportunity stage X. |
| **HubSpot** | Tickets pipeline ≠ deals pipeline. Subscriptions, Services, Orders objects. Projects object type id `0-970`. Deal pipelines can model renewals separately. Associations connect ticket↔deal↔contact without forcing conversion gates. | [CRM object IDs](https://developers.hubspot.com/docs/api/crm/understanding-the-crm), [Pipelines](https://developers.hubspot.com/docs/api/crm/pipelines), [Associate records](https://knowledge.hubspot.com/records/associate-records) | **Parallel objects + optional association** |
| **Microsoft D365** | Sales Hub opportunities independent of Customer Service cases. Project Operations: Lead→Opportunity→Quote→**Project Contract**→delivery; project estimation can start from templates; SOW/contract is its own artifact. Copy opportunity does **not** copy activities/quotes (preview). | [Sales overview](https://learn.microsoft.com/en-us/dynamics365/sales/overview), [CS overview](https://learn.microsoft.com/en-us/dynamics365/customer-service/overview), [Project Ops sales](https://learn.microsoft.com/en-us/dynamics365/project-operations/sales/sales-overview), [Copy opportunity](https://learn.microsoft.com/en-us/dynamics365/sales/create-edit-opportunity-sales) | **App/entity split with optional BPF glue** |
| **Zoho CRM** | CRM process objects + portals + support channels in CRM Plus-style bundles; Projects often via Zoho suite integration (product ecosystem). Inventory/CPQ on higher editions. | [Pricing](https://www.zoho.com/crm/pricing.html), [Features](https://www.zoho.com/crm/features.html) | Suite integration; help pages thin this pass for Projects deep-link |
| **Pipedrive** | **Projects** after win: AI-assisted brief from deal emails/notes/files; boards, tasks, dependencies, Gantt (beta); automations on project events; link project to deal permissioned. Explicit value prop: sales and delivery one platform without mandatory tool switch. | [Projects product](https://www.pipedrive.com/en/crm/resources/crm-project-management), [API Projects](https://developers.pipedrive.com/docs/api/v1), [Permissions](https://support.pipedrive.com/en/article/permission-sets) | **Deal-linked but operationally separate board**; start from won deal is common path, not a proof that non-deal projects are impossible at API level |

**BLRO note (critical for I-02):** Commercial CRMs allow **service, project, renewal** as **parallel entry points**. Handoff from deal→project is a **convenience**, not a universal hard gate for all work types.

---

### 2.5 Automation

| Vendor | Documented behavior | Sources |
|---|---|---|
| **Salesforce** | Drag-drop workflow/process automation on Sales Cloud; Flows reused as Agentforce actions (FAQ). Trailhead covers Approval Processes. | [Sales features](https://www.salesforce.com/products/sales-cloud/features/), [How Agentforce works FAQ](https://www.salesforce.com/agentforce/how-it-works/), [Trailhead approvals badge](https://trailhead.salesforce.com/content/learn/modules/business_process_automation) |
| **HubSpot** | Workflows: from scratch / AI / templates. Enrollment: filter, event, schedule, webhook; re-enrollment rules; actions on enrolled + associated records. Object-type dependent. | [Create workflows KB](https://knowledge.hubspot.com/workflows/create-workflows) (updated 2026-08-03) |
| **Microsoft D365** | Power Automate: automated / instant / scheduled cloud flows; **create with Copilot via NL prompt**; Approvals “start and wait”; Dataverse triggers. | [Cloud flows overview](https://learn.microsoft.com/en-us/power-automate/overview-cloud) (updated 2026-07-28), [Approvals tutorial](https://learn.microsoft.com/en-us/power-automate/modern-approvals), [PA home/Copilot](https://learn.microsoft.com/en-us/power-automate/getting-started) |
| **Zoho CRM** | Workflow rules, assignment rules, cadences, Blueprint stage actions, custom functions, journey orchestration (edition-gated). Zia can **suggest/generate workflows**. | [Features](https://www.zoho.com/crm/features.html), [Pricing edition lists](https://www.zoho.com/crm/pricing.html), [Zia](https://www.zoho.com/crm/zia/) |
| **Pipedrive** | Automations = trigger + action; triggers on deal/person/activity/lead/org/project add/update/delete **or date** (renewal/deadline). Actions create/update/delete + email. Imports generally don’t fire event automations (exception: lead update/delete). Growth+. | [Automations first steps](https://support.pipedrive.com/en/article/workflow-automation) (updated 2025-08-06; still served 2026-08) |

**BLRO note:** Automation is **event/condition → action**, orthogonal to “must click stage advance.” Stage change is merely one popular trigger.

---

### 2.6 AI agents / copilots

| Vendor | Documented behavior | Sources | MKT vs DOC |
|---|---|---|---|
| **Salesforce Agentforce** | AI agent platform: build/test/deploy/monitor; Agent Builder; actions from Flows/Apex/MuleSoft/prompts; guardrails; Einstein Trust Layer (grounding, zero retention claims, toxicity); Audit Trail for AI actions; multi-agent orchestration; OOTB SDR/Service/Coach/etc.; employee agents in Lightning/Mobile/Slack. | [Agentforce](https://www.salesforce.com/agentforce/), [How it works](https://www.salesforce.com/agentforce/how-it-works/), [Sales AI](https://www.salesforce.com/products/sales-cloud/features/sales-cloud-einstein/), [llms.txt](https://www.salesforce.com/llms.txt) | Autonomy “24/7” and ROI numbers are MKT; builder+trust+action model is product-real. |
| **HubSpot Agent Hub / Breeze** | Central agent management; Prospecting agent (signals, outreach, CRM update approval), Customer agent, Data agent; AEO; agents grounded in CRM; custom agents from prompts/knowledge/tools; Breeze Assistant surface. | [Agent Hub](https://www.hubspot.com/products/artificial-intelligence), [llms.txt](https://www.hubspot.com/llms.txt) | Percentage lift stats are MKT. “Approve automatic CRM updates” is an important **human-in-the-loop** DOC signal. |
| **Microsoft** | Copilot in D365 Sales: NL or prompts; summarize lead/opp/account; recent changes; meeting prep; email assist; SharePoint answers; respects user record permissions. Evolution toward **Sales agent in M365 Copilot**. Prebuilt agents: Qualification (research / research+engage), Opportunity, Close (preview), Research; custom via Copilot Studio. CS has Copilot agents too. | [Copilot overview](https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview) (updated 2026-04-08), [Sales overview agents](https://learn.microsoft.com/en-us/dynamics365/sales/overview), [D365 Sales product](https://www.microsoft.com/en-us/dynamics-365/products/sales), [CS Copilot agents](https://learn.microsoft.com/en-us/dynamics365/customer-service/overview) | “Autonomous closing” is preview/MKT-heavy; permission-bounded copilot is DOC. |
| **Zoho Zia** | Predictions, scores, churn, recommendations, anomaly detection, forecasting assists, enrichment; **AI Agents for Sales**; GenAI for content + **module/workflow/report creation**; voice prompts. | [Zia](https://www.zoho.com/crm/zia/), [Generative AI](https://www.zoho.com/crm/zia-voice.html) (gen AI page), [Features](https://www.zoho.com/crm/features.html) | “Autonomous agents” breadth less independently documented than SF/MS builder stacks this pass. |
| **Pipedrive AI** | AI Sales Assistant (insights, patterns, goal prompts, KB help); win probability notifications; AI email writer/summarizer; NL Insights reports; NL marketplace search; OpenAI subprocessors; **states client data not used to train third-party models without permission**. | [AI CRM](https://www.pipedrive.com/en/products/ai-crm), [AI Sales Assistant](https://www.pipedrive.com/en/features/ai-sales-assistant) | Assistant ≠ multi-department digital workforce. |

**BLRO note:** Leaders converge on **role-specialized agents + CRM grounding + human escalation/approval**, not a single chat box without tools/permissions.

---

### 2.7 Natural-language creation / actions

| Vendor | What NL can create/do (documented) | Sources |
|---|---|---|
| **Salesforce** | Agent jobs/instructions/actions via NL in Agent Builder; conversational employee agents; formula/segment generation claims in Sales AI planning. | [How Agentforce works](https://www.salesforce.com/agentforce/how-it-works/), [Sales AI](https://www.salesforce.com/products/sales-cloud/features/sales-cloud-einstein/) |
| **HubSpot** | Create workflow from NL (“When X, then Y”); Breeze Assistant; KB: create custom object / pipeline via Breeze Copilot/Assistant. | [Workflows KB](https://knowledge.hubspot.com/workflows/create-workflows), [Custom objects KB](https://knowledge.hubspot.com/object-settings/create-custom-objects), [Pipelines KB](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines) |
| **Microsoft** | Copilot Q&A on sales records; **Dataverse tables from NL description**; Power Automate flows from NL. | [Copilot Sales](https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview), [Tables + Copilot](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities-portal), [Cloud flows](https://learn.microsoft.com/en-us/power-automate/overview-cloud) |
| **Zoho** | Zia generates modules, workflows, reports from specified details; data Q&A; email generation; Canvas from image/sketch; voice prompts. | [Gen AI](https://www.zoho.com/crm/zia-voice.html), [Zia](https://www.zoho.com/crm/zia/) |
| **Pipedrive** | NL report generation; assistant Q&A; NL app search; email from prompts. | [AI CRM](https://www.pipedrive.com/en/products/ai-crm) |

**BLRO note (I-03):** NL is used to **author structure and draft actions**, still subject to schema/permissions — not to bypass object model.

---

### 2.8 Approval / permissions / audit

| Vendor | Documented behavior | Sources |
|---|---|---|
| **Salesforce** | Approval processes training content exists; quoting/contract approvals marketed; Agentforce Guardrails + Trust Layer + **Audit Trail for AI outputs/actions**; platform access controls. | Trailhead approvals module hub, [Sales features](https://www.salesforce.com/products/sales-cloud/features/), [Agentforce how-it-works security FAQ](https://www.salesforce.com/agentforce/how-it-works/) |
| **HubSpot** | Pipeline rules: control editing access, **require approval**; workflow publish permissions; custom object create needs account access perms; association limits by SKU. | [Pipelines KB](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines), [Workflows KB](https://knowledge.hubspot.com/workflows/create-workflows), [Custom objects KB](https://knowledge.hubspot.com/object-settings/create-custom-objects) |
| **Microsoft** | Entra ID auth; security roles; business units; sharing; hierarchy/matrix BU; **column-level security**; **Dataverse auditing** (who changed what/when, old/new values, access logs, retention); activity logging to Purview; PA Approvals center. Copilot only sees permitted records. | [Security concepts](https://learn.microsoft.com/en-us/power-platform/admin/wp-security-cds), [Column security](https://learn.microsoft.com/en-us/power-platform/admin/field-level-security), [Auditing](https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing), [Copilot privacy](https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview), [Approvals](https://learn.microsoft.com/en-us/power-automate/modern-approvals) |
| **Zoho** | Profiles/roles/data sharing are core CRM security (help bodies blocked); Blueprint enforces process checks; portals for external least-privilege access. | [Customization/portals](https://www.zoho.com/crm/customization.html), [Blueprint](https://www.zoho.com/crm/blueprint.html); help URLs indexed but not fully fetched |
| **Pipedrive** | **Permission sets** = what you can do; **Visibility groups** = what you can see; separate deal/global/project/campaign permission categories; custom sets by plan; Security center monitoring + audit logs marketed. | [Permission sets](https://support.pipedrive.com/en/article/permission-sets) (updated 2025-11-18), [Visibility groups](https://support.pipedrive.com/en/article/visibility-groups), [Features security](https://www.pipedrive.com/en/features) |

**BLRO note (I-05):** Guardrails = **permissions + optional approvals + audit**, applied to actions — not “the only door is the next stage button.”

---

## 3. Side-by-side pattern map (architecture lens)

```
Customer/Account graph
  ├─ Sales objects (Lead/Opp/Deal) ── pipelines (1..N)
  ├─ Service objects (Case/Ticket) ── pipelines (1..N)
  ├─ Delivery objects (Project/Work Order) ── boards/phases
  ├─ Commercial objects (Quote/Order/Subscription/Asset)
  ├─ Activities/Engagements (timeline) ── many-to-many associations
  ├─ Automation engine (events → actions) ── optional stage triggers
  ├─ AI agents/copilots (tool-using, permission-bound)
  └─ Security (RBAC/visibility) + Approvals + Audit log
```

| Pattern | SF | HS | MS | Zoho | PD |
|---|---|---|---|---|---|
| Graph of business objects | Strong (platform) | Strong (DOC) | Strong (Dataverse) | Strong (modules) | Medium (fixed set) |
| Multiple pipelines | Yes (edition) | Yes (DOC) | BPF + stages | Pipeline + Blueprint | Yes (deals) |
| Non-sales work objects | Service Cloud etc. | Tickets/Projects/Services | CS + Project Ops | Team modules / suite | Projects |
| Activities independent of stage | Yes | Yes (DOC) | Yes | Yes | Yes (core) |
| AI with action tools | Agentforce | Agent Hub | Sales agents + Studio | Zia agents | Assistant (narrower) |
| NL authoring | Yes | Yes (DOC) | Yes (DOC) | Yes (DOC) | Partial |
| Enterprise audit | Trust/platform | SKU-dependent | Dataverse audit DOC | Present (less verified) | Security center |

---

## 4. Copy / Reject lessons for BLRO

### 4.1 COPY (aligns with BLRO intent I-01…I-07)

1. **Customer-centric graph, not stage-centric monolith**  
   HubSpot associations + object catalog; Dataverse relationships; Salesforce Customer 360 framing.  
   → BLRO should keep Account/Customer as hub; Deal, Project, PoC, Support, Renewal, Finance as **peer objects with links**.

2. **Multiple pipelines per process type**  
   HubSpot explicitly models separate deal pipelines (e.g. renewals) and non-deal pipelines (tickets/projects/custom).  
   → BLRO: renewal pipeline ≠ new-business pipeline ≠ support pipeline.

3. **Parallel entry points**  
   D365 CS cases and Project Ops contracts exist without “must be opportunity stage Z.” Pipedrive Projects are delivery boards linked to deals.  
   → BLRO: allow **Create Support / Create Project / Create Renewal / Create PoC** from customer context; deal conversion is one path.

4. **Activities as universal work fabric**  
   All five attach tasks/calls/meetings/notes across records. HubSpot explicitly rejects “Notes custom object” anti-pattern.  
   → BLRO: one activity/work timeline; stop burying exclusive actions inside stage panels.

5. **Automation orthogonal to stage gates**  
   Event/date/webhook triggers everywhere; stage change is optional trigger. Pipedrive date triggers even cover **contract renewal** style deadlines.  
   → BLRO: encode policy in automations/approvals, not only in “Next stage” buttons.

6. **Process enforcement is opt-in and scoped (Blueprint / BPF / pipeline rules)**  
   Zoho Blueprint and MS BPF show **guided process with checks** without making the entire OS a single linear funnel.  
   → BLRO: keep strong gates for **money/risk** (discount, contract, production cutover); light gates for research/admin work.

7. **AI as role agents with tools + approval modes**  
   SF Agentforce actions; HS prospecting agent “approve CRM updates”; MS permission-bounded Copilot; observability/audit.  
   → BLRO Color Agents should be **tool-using workers** with suggest vs auto modes, not only classifiers on a deal page.

8. **NL to structure, human to confirm**  
   MS table-from-NL, HS workflow-from-NL, Zoho module-from-NL, Pipedrive report-from-NL.  
   → BLRO: “대표가 말한 한 줄” → draft objects/tasks → confirm → write.

9. **Permissions ≠ visibility ≠ audit (separate axes)**  
   Pipedrive permission sets vs visibility groups; Dataverse RBAC + column security + audit.  
   → BLRO: AI employees need **service identities**, scoped writes, immutable action log.

10. **Handoff packs context, doesn’t erase history**  
    Pipedrive AI project brief from deal emails/notes/files; MS opportunity copy rules show what should/shouldn’t clone.  
    → BLRO deal→project should **carry context snapshot + links**, not hard-delete sales path or block reverse navigation.

### 4.2 REJECT (anti-patterns seen in weaker products or easy to mis-copy)

1. **Reject: One global linear stage machine for all company work**  
   No vendor forces support+renewal+project+finance through a single sales stage path as the only OS spine. That is a BLRO self-inflicted constraint (brief I-01/I-02/I-05).

2. **Reject: Custom-object sprawl that clones people or replaces activities**  
   HubSpot KB anti-patterns map directly to BLRO risk (duplicate party model, fragmented timelines).

3. **Reject: Pipeline-per-team vanity splits**  
   HubSpot: if stages are identical, use permissions/teams — not duplicate pipelines. Prevents board explosion.

4. **Reject: AI autonomy without Trust Layer equivalents**  
   Copying “agents 24/7” marketing without audit, grounding, and least privilege is unsafe for partner/customer data (blro.co.kr mail reality).

5. **Reject: Equating Pipedrive simplicity with full Partner OS needs**  
   Pipedrive’s fixed entity set is excellent for SMB sales+delivery; BLRO’s manufacturer→partner→customer multi-party + finance needs HubSpot/Dataverse-class modeling **or** deliberate modular suite — not only deal kanban.

6. **Reject: Stage gate as substitute for permissions**  
   Hiding a button behind stage ≠ security. MS/Pipedrive separate **can do** from **can see**.

7. **Reject: Silent CRM mutations by AI**  
   Prefer HubSpot-style **approve drafts** default for external mail and record writes; auto only for low-risk enrichments.

8. **Reject: Marketing ROI % as design requirements**  
   Ignore uncited lift metrics when prioritizing roadmap; use capability patterns above.

### 4.3 Boundary lessons (design rules)

| Boundary | Rule for BLRO |
|---|---|
| **Flexibility vs control** | Default open create on customer graph; attach **policy hooks** (approval, required fields, Blueprint-like checks) only on irreversible/commercial actions. |
| **Deal vs Project** | Association + handoff template; project may exist without won deal (internal, retainer, partner enablement). |
| **Renewal** | Own object/pipeline + date-trigger automation from assets/contracts; not a dead-end list view. |
| **AI employee** | Same objects/UI as humans; distinct actor in audit; tools whitelisted; confidence + human escalate. |
| **NL entry** | Always produces **draft plan** (objects, fields, tasks, links) before commit. |
| **Automation** | Prefer domain events (`renewal_due`, `mail_classified`, `poc_requested`) over UI stage enums. |
| **Suite temptation** | SF/MS/Zoho win by platform breadth — BLRO should integrate finance/mail deeply but keep CRM core coherent (avoid menu sprawl without graph). |

---

## 5. Implications mapped to BLRO brief intents

| Intent | Commercial evidence | Product implication |
|---|---|---|
| I-01 Customer/work context center | HS/MS/SF object graphs | Demote deal-detail as sole OS shell |
| I-02 Independent starts | CS/Projects/Renewal pipelines | Add first-class create routes |
| I-03 NL → structured work | HS/MS/Zoho NL builders | Global assistant commits drafts |
| I-04 Role AI collaboration | Agentforce / Agent Hub / Sales agents | Bind Color Agents to CRM tools |
| I-05 Process as guardrail | Blueprint/BPF/approvals optional | Stage gates only where risk demands |
| I-06 Connected customer context | Associations / Dataverse rel | Unify timeline + graph UI |
| I-07 Best-of-breed + AI edge | All moving to agentic CRM | Differentiate on mail-native + partner multi-party + AI staff — not on stricter funnel |

---

## 6. Source index (fetched 2026-08-13)

### Salesforce
- https://www.salesforce.com/products/sales-cloud/features/
- https://www.salesforce.com/products/sales-cloud/pricing/
- https://www.salesforce.com/agentforce/
- https://www.salesforce.com/agentforce/how-it-works/
- https://www.salesforce.com/products/sales-cloud/features/sales-cloud-einstein/
- https://www.salesforce.com/service/
- https://www.salesforce.com/platform/
- https://www.salesforce.com/crm/
- https://www.salesforce.com/llms.txt
- https://trailhead.salesforce.com/content/learn/modules/business_process_automation (shell)

### HubSpot
- https://developers.hubspot.com/docs/api/crm/understanding-the-crm
- https://developers.hubspot.com/docs/api/crm/crm-custom-objects
- https://developers.hubspot.com/docs/api/crm/pipelines
- https://knowledge.hubspot.com/object-settings/create-custom-objects
- https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines
- https://knowledge.hubspot.com/records/associate-records
- https://knowledge.hubspot.com/workflows/create-workflows
- https://www.hubspot.com/products/artificial-intelligence
- https://www.hubspot.com/llms.txt

### Microsoft
- https://learn.microsoft.com/en-us/dynamics365/sales/overview
- https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview
- https://learn.microsoft.com/en-us/dynamics365/sales/create-edit-opportunity-sales
- https://learn.microsoft.com/en-us/dynamics365/customer-service/overview
- https://learn.microsoft.com/en-us/dynamics365/project-operations/sales/sales-overview
- https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities-portal
- https://learn.microsoft.com/en-us/power-platform/admin/wp-security-cds
- https://learn.microsoft.com/en-us/power-platform/admin/wp-security
- https://learn.microsoft.com/en-us/power-platform/admin/field-level-security
- https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing
- https://learn.microsoft.com/en-us/power-automate/overview-cloud
- https://learn.microsoft.com/en-us/power-automate/modern-approvals
- https://learn.microsoft.com/en-us/power-automate/getting-started
- https://www.microsoft.com/en-us/dynamics-365/products/sales

### Zoho
- https://www.zoho.com/crm/features.html
- https://www.zoho.com/crm/pricing.html
- https://www.zoho.com/crm/zia/
- https://www.zoho.com/crm/zia-voice.html
- https://www.zoho.com/crm/blueprint.html
- https://www.zoho.com/crm/customization.html
- https://www.zoho.com/crm/sales-force-automation.html
- https://www.zoho.com/crm/what-is-crm.html
- Help index (via search): custom modules, design blueprint articles on help.zoho.com

### Pipedrive
- https://www.pipedrive.com/en/features
- https://www.pipedrive.com/llms.txt
- https://www.pipedrive.com/en/products/ai-crm
- https://www.pipedrive.com/en/features/ai-sales-assistant
- https://www.pipedrive.com/en/crm/resources/crm-project-management
- https://support.pipedrive.com/en/article/custom-fields
- https://support.pipedrive.com/en/article/workflow-automation
- https://support.pipedrive.com/en/article/permission-sets
- https://support.pipedrive.com/en/article/visibility-groups
- https://developers.pipedrive.com/docs/api/v1

---

## 7. Research ops note

- **≥12 searches / full-page fetches:** yes (130+ URL attempts under `/tmp/crm-research`; primary successes listed above).  
- **5th CRM chosen:** Pipedrive — strong official docs on activity-based selling, projects handoff, permissions split; useful contrast to platform CRMs.  
- **Raw HTML cache:** `/tmp/crm-research/` (ephemeral).  
- **This deliverable path:** `artifacts/crm-research/2026-08-13-commercial-crm-comparison-matrix.md`

---

## EXPAND
