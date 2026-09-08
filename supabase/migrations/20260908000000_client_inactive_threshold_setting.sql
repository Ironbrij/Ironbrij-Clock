-- M46: the casual-service client-inactivity threshold (currently a hardcoded
-- 90 days, CLIENT_INACTIVE_THRESHOLD_DAYS in workspace-store.tsx) was a
-- placeholder from the original reverse-engineering pass — the accounts
-- team's workbook staleness rule wasn't recoverable from its formulas.
-- Promoted to a workspace-wide setting, same reasoning and pattern as
-- casual_billing_increment_hours (20260903020000): tunable without a code
-- deploy once accounts confirms the real number. Default stays 90 until
-- then. Computed client-side at read time in useClientHealth
-- (workspace-store.tsx) — never stored, same as the health status itself.
ALTER TABLE public.workspace_settings
  ADD COLUMN client_inactive_threshold_days integer NOT NULL DEFAULT 90
    CONSTRAINT workspace_settings_client_inactive_threshold_check
      CHECK (client_inactive_threshold_days > 0);
