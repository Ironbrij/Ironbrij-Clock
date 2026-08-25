-- M27: projects had no equivalent of clients.subscription_hours — no way
-- to flag a fixed-scope/capped-hours project as approaching or over its
-- allotted hours, the way an over-budget client already surfaces via
-- ClientProfileDialog/useClientBudgets. Same shape as
-- 20260807020000_client_profile_fields.sql's subscription_hours, plus a
-- non-negative CHECK from the start (that column didn't get one until
-- L24 covered a different table — added here proactively instead of
-- waiting for a follow-up pass).
ALTER TABLE public.projects
  ADD COLUMN budget_hours numeric(10,2),
  ADD CONSTRAINT projects_budget_hours_check CHECK (budget_hours IS NULL OR budget_hours >= 0);
