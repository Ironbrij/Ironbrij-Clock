-- set_member_role only ever checked "is the caller an admin" — unlike
-- removeUserAccess (admin.functions.ts), which already refuses to delete
-- the last remaining active admin, nothing stopped a role change from
-- demoting the last admin (including themselves) down to manager/member,
-- via a single Settings > Users dropdown selection with no confirmation.
-- That would leave the workspace with no one able to approve members,
-- manage roles, or reach any other admin-only screen. This mirrors the
-- same "count active admins excluding the target" guard removeUserAccess
-- already uses.
CREATE OR REPLACE FUNCTION public.set_member_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_role public.app_role;
  _remaining_admins int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  SELECT role INTO _old_role FROM public.profiles WHERE id = _user_id;

  IF _old_role = 'admin' AND _role <> 'admin' THEN
    SELECT COUNT(*) INTO _remaining_admins
    FROM public.profiles
    WHERE role = 'admin' AND is_active = true AND id <> _user_id;

    IF _remaining_admins = 0 THEN
      RAISE EXCEPTION 'Can''t change this — they are the last remaining admin.';
    END IF;
  END IF;

  UPDATE public.profiles SET role = _role WHERE id = _user_id;

  INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
  VALUES (
    auth.uid(),
    'role_changed',
    _user_id,
    jsonb_build_object('old_role', _old_role, 'new_role', _role)
  );
END;
$$;
