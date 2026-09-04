-- M46: casual-billing rounding increment (e.g. round up casual-service
-- hours to the nearest 0.25h, matching the accounts team's manual
-- workbook practice) is a workspace-wide setting rather than a hardcoded
-- constant, so it can be tuned without a code deploy — same reasoning
-- require_descriptions/allow_manual_entry are settings, not constants.
-- The rounding itself happens client-side, at report time, in
-- src/lib/casual-billing.ts — it never mutates stored hours.
ALTER TABLE public.workspace_settings
  ADD COLUMN casual_billing_increment_hours numeric(4,2) NOT NULL DEFAULT 0.25
    CONSTRAINT workspace_settings_casual_increment_check CHECK (casual_billing_increment_hours > 0);
