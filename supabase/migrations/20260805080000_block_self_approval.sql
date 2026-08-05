-- Closes a real hole: inviting someone with the admin role gave them
-- has_role(admin) = true immediately, before anyone ever approved them —
-- because role is set at invite time, not at approval time. Combined
-- with approve_member only checking "is the caller an admin" and never
-- "are they approving themselves," a freshly-invited admin could open
-- their own pending row and approve their own account, skipping human
-- review entirely. This is the actual fix: nobody, regardless of role,
-- can ever approve their own account.
CREATE OR REPLACE FUNCTION public.approve_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve members';
  END IF;

  IF auth.uid() = _user_id THEN
    RAISE EXCEPTION 'You cannot approve your own account.';
  END IF;

  UPDATE public.profiles
  SET is_pending = false
  WHERE id = _user_id;
END;
$$;
