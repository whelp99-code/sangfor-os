\echo '=== 1. 메일 후보 큐 리드타임 (created_at → updated_at, resolved 후보만) ==='
-- No dedicated resolvedAt column on mail_derived_candidates; updated_at is used
-- as an approximation and is only accurate if nothing else touches the row
-- after resolution (revalidation writes also bump updated_at, so this
-- over-estimates lead time for candidates that got re-revalidated).
select
  count(*) as resolved_count,
  round(avg(extract(epoch from (updated_at - created_at)) / 86400.0)::numeric, 2) as avg_days,
  round((percentile_cont(0.5) within group (order by extract(epoch from (updated_at - created_at))) / 86400.0)::numeric, 2) as median_days
from mail_derived_candidates
where status in ('approved', 'converted', 'rejected', 'knowledge_only');

\echo ''
\echo '=== 2. 큐 상태 분포 (컨텍스트) ==='
select status, count(*) from mail_derived_candidates group by status order by 2 desc;

\echo ''
\echo '=== 3. 후보 정밀도 (승인율 = (approved+converted) / (approved+converted+rejected)) ==='
select
  count(*) filter (where status in ('approved', 'converted')) as approved_count,
  count(*) filter (where status = 'rejected') as rejected_count,
  round(
    100.0 * count(*) filter (where status in ('approved', 'converted'))
    / nullif(count(*) filter (where status in ('approved', 'converted', 'rejected')), 0),
    1
  ) as precision_pct
from mail_derived_candidates;

\echo ''
\echo '=== 4. 자동 승인 비율 (domain_decision_logs, actor::text = ''ai'') ==='
-- DecisionActor enum has no 'ai' value until the M3 migration (05 문서),
-- so this is structurally 0% today — not a bug.
select
  count(*) filter (where actor::text = 'ai') as ai_decisions,
  count(*) as total_decisions,
  round(100.0 * count(*) filter (where actor::text = 'ai') / nullif(count(*), 0), 1) as ai_pct
from domain_decision_logs;

\echo ''
\echo '=== 5. 재무 <-> engagement 연결률 ==='
select
  'Cashflow' as table_name,
  count(*) filter (where engagement_id is not null) as linked,
  count(*) as total
from finance_cashflows
union all
select 'Invoice', count(*) filter (where engagement_id is not null), count(*)
from finance_invoices
union all
select 'Expense', count(*) filter (where engagement_id is not null), count(*)
from finance_expenses
union all
select 'TaxInvoice', count(*) filter (where engagement_id is not null), count(*)
from finance_tax_invoices;

\echo ''
\echo '=== 5b. 재무 <-> engagement 연결률 (합계) ==='
select
  sum(linked) as linked,
  sum(total) as total,
  round(100.0 * sum(linked) / nullif(sum(total), 0), 1) as pct
from (
  select count(*) filter (where engagement_id is not null) as linked, count(*) as total from finance_cashflows
  union all
  select count(*) filter (where engagement_id is not null), count(*) from finance_invoices
  union all
  select count(*) filter (where engagement_id is not null), count(*) from finance_expenses
  union all
  select count(*) filter (where engagement_id is not null), count(*) from finance_tax_invoices
) t;

\echo ''
\echo '=== 6. 자율도 표본 축적 (domain_decision_logs, decision_type=human_review, 도메인별) ==='
-- Mirrors getDomainAutonomy() in packages/business/src/project-decision.ts.
-- MIN_AUTONOMY_SAMPLE threshold there gates learning-vs-scored state;
-- targets here are the roadmap's 9월 >=10 / 12월 >=30 per domain.
select domain, count(*) as sample_count
from domain_decision_logs
where decision_type = 'human_review'
group by domain
order by sample_count desc;
