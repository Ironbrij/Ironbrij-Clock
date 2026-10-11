-- RLS audit 2026-10-11: a non-admin could make themselves an admin by
-- writing their own profiles row directly through PostgREST, and from there
-- read every member_employment / billing_rates / va_placements row. Three
-- separate holes, closed together here:
--
-- 1. INSERT was granted on every column (20260804000910_...sql), and
--    profiles_insert_self only checks id = auth.uid() — so anyone signed in
--    with no profile row yet (a removed member who signed back in, a spoofed
--    invite, an uninvited company-domain address) could insert their own row
--    with role = 'admin'.
-- 2. UPDATE was meant to be column-limited (the original grant leaves out
--    role and is_active), but Supabase's default privileges also grant ALL
--    on every new public table to anon/authenticated, and a table-level
--    UPDATE grant overrides a column list — nothing ever revoked it. The
--    column list itself also included is_pending (self-approval) and email
--    (which the signup hook below trusts to decide who may create an
--    account).
-- 3. hook_restrict_signup_to_invited (20260805050000) trusted
--    user_metadata.invited_by_admin, which the caller supplies themselves on
--    /auth/v1/signup or /auth/v1/otp (options.data) — so it never proved an
--    admin sent the invite. It also let any email with a profiles row sign
--    up again, including removed members, whose rows removeUserAccess keeps
--    on purpose (inactive) to preserve their history.
--
-- Defense in depth, same as everywhere else in this schema: the grants are
-- the first layer, and a trigger re-checks the privileged columns in case a
-- future migration re-grants the table wholesale.

-- ============ 1 & 2: grants ============
-- Revoking table-level privileges also revokes every column-level grant, so
-- this starts from nothing and re-grants exactly what the app uses:
--   SELECT — profiles_select_all (RLS still decides which rows).
--   INSERT — the first-sign-in bootstrap in use-members.ts
--            (id, email, full_name, avatar_url, job_title, is_pending).
--            role/is_active fall back to their defaults ('member', true).
--   UPDATE — updateProfile, uploadAvatar and updateMemberTimezone in
--            use-members.ts. role and is_pending changes go through
--            set_member_role / approve_member (SECURITY DEFINER, admin-only).
--            is_active and email are changed only by admin.functions.ts,
--            which runs as service_role.
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT (id, email, full_name, avatar_url, job_title, timezone, is_pending)
  ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, job_title, timezone) ON public.profiles TO authenticated;

-- ============ backstop trigger ============
-- Applies only when the statement runs directly as a PostgREST end-user role.
-- service_role (admin.functions.ts) and SECURITY DEFINER functions
-- (set_member_role, approve_member — which run as their owner and do their
-- own has_role(admin) check) pass straight through. That's why this function
-- is deliberately NOT SECURITY DEFINER: current_user has to reflect the
-- caller.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'member'
       OR NEW.is_pending IS DISTINCT FROM true
       OR NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'A new profile must start as a pending member.'
        USING ERRCODE = '42501';
    END IF;
    -- The signup hook lets anyone whose email matches an active profile
    -- create an account, so a self-inserted row must carry the caller's own
    -- verified email — otherwise anyone signed in could invite an outsider.
    IF NEW.id = auth.uid()
       AND lower(coalesce(NEW.email, '')) IS DISTINCT FROM lower(coalesce(auth.jwt() ->> 'email', '')) THEN
      RAISE EXCEPTION 'A profile''s email must match the signed-in account.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_pending IS DISTINCT FROM OLD.is_pending
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Role, approval, active status and email can only be changed by an admin.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- ============ 3: server-side invite list for the signup hook ============
-- inviteMembers (admin.functions.ts) records each address here via
-- service_role *before* calling inviteUserByEmail, so the hook can check an
-- invite the caller can't fake. removeUserAccess deletes the row again. No
-- policies and no grants to anon/authenticated: only service_role and the
-- SECURITY DEFINER hook (which runs as the table owner) can touch it.
CREATE TABLE IF NOT EXISTS public.signup_invites (
  email text PRIMARY KEY CHECK (email = lower(email)),
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_invites FROM anon, authenticated;
GRANT ALL ON public.signup_invites TO service_role;

-- Same rules as before, minus the two holes:
--   * user_metadata.invited_by_admin is no longer trusted at all;
--     signup_invites replaces it.
--   * the "a profile already exists for this email" path now requires the
--     profile to be active, so a removed member can't sign back up. Re-invite
--     them instead; inviteMembers then folds their old history onto the new
--     account, as it already does.
-- The company-domain allowance is unchanged on purpose (it's the original
-- rule from 20260805040000). Those accounts still start as pending members,
-- which the trigger above now enforces.
create or replace function public.hook_restrict_signup_to_invited(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _email text;
  _domain text;
begin
  _email := lower(event->'user'->>'email');
  _domain := split_part(_email, '@', 2);

  if _domain in ('ironbrij.com', 'ironbrij.com.au') then
    return '{}'::jsonb;
  end if;

  if exists (select 1 from public.signup_invites where email = _email) then
    return '{}'::jsonb;
  end if;

  if exists (
    select 1 from public.profiles where lower(email) = _email and is_active
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This account needs to be invited by an admin first.',
      'http_code', 403
    )
  );
end;
$$;

grant execute on function public.hook_restrict_signup_to_invited(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_to_invited(jsonb) from authenticated, anon, public;
