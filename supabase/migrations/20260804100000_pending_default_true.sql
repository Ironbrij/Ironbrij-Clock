-- New sign-ins (including Google) should land in the approval queue by default.
-- Previously defaulted to false, which let anyone through immediately.
ALTER TABLE public.profiles ALTER COLUMN is_pending SET DEFAULT true;
