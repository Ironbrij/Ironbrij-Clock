-- L24: hourly_rate only had client-side non-negative validation
-- (manage.tsx's saveRate) — nothing stopped a negative rate reaching the
-- table via a direct API call. Nullable stays allowed (no rate set yet).
ALTER TABLE public.member_employment
  ADD CONSTRAINT member_employment_hourly_rate_check CHECK (hourly_rate IS NULL OR hourly_rate >= 0);
