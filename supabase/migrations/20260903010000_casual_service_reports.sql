-- M46: Casual Service Monitoring — client-health RPC.
--
-- time_entries_select already scopes a plain SELECT correctly (self;
-- admin sees all; manager sees shared-team), so the Reports "Casual
-- Service" tab's client x category rollup is computed client-side from
-- the same detailedEntriesForRange rows the Detailed tab already fetches
-- — not a separate aggregate RPC. That matters here specifically because
-- the billing-increment rounding rule (src/lib/casual-billing.ts) rounds
-- *per task line*, then sums — a SUM(duration_minutes) done first and
-- rounded after would produce a different (wrong) total.
--
-- This RPC is the one piece that genuinely needs SECURITY DEFINER: the
-- client-health signal (last casual-service date per client) has to be
-- company-wide and all-time, not scoped to whatever date range a report
-- happens to be showing.
CREATE OR REPLACE FUNCTION public.casual_client_last_service()
RETURNS TABLE (client_id uuid, last_service_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.client_id, MAX(te.entry_date)
  FROM public.time_entries te
  JOIN public.projects p ON p.id = te.project_id
  WHERE te.service_category IS NOT NULL AND p.client_id IS NOT NULL
  GROUP BY p.client_id;
$$;
REVOKE ALL ON FUNCTION public.casual_client_last_service() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.casual_client_last_service() TO authenticated;
