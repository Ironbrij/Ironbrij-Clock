-- M41: activity_log's own query is correctly capped client-side
-- (use-activity-log.ts, .order("created_at", { ascending: false }).limit(300)),
-- but nothing backs that ORDER BY ... LIMIT with an index — every other
-- hot query in this schema has one for exactly the columns it filters/sorts
-- by (time_entries_user_date_idx, timesheets_user_week_idx), this table
-- never did. Harmless today at this workspace's actual activity volume,
-- worth having before a sequential scan is the thing someone has to
-- diagnose two years in — activity_log is genuinely append-only with no
-- retention policy anywhere in this schema.
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON public.activity_log (created_at DESC);
