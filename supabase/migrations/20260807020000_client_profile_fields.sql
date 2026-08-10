-- Client profile fields: contact info, Basecamp link, and a subscription
-- hours allowance. "Rendered" hours already exist as a computed value
-- (sum of tracked time across the client's projects) — only the
-- allowance itself needs to be stored; "remaining" is just subscription
-- minus rendered, computed client-side.
ALTER TABLE public.clients
  ADD COLUMN basecamp_url text,
  ADD COLUMN contact_name text,
  ADD COLUMN contact_email text,
  ADD COLUMN subscription_hours numeric(10,2);
