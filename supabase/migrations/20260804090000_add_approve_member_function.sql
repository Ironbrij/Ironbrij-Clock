-- Lets an admin clear is_pending on someone else's profile, gating dashboard
-- access on approval rather than on invite alone. Uses the same has_role
-- pattern as the existing set_member_role function so only admins can call it.
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

  UPDATE public.profiles
  SET is_pending = false
  WHERE id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_member(uuid) TO authenticated;
