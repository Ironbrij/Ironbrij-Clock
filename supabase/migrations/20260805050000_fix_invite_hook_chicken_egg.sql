-- Fixes a bug in 20260805040000: the hook checked whether a profiles row
-- already existed for the invited email, but for a brand-new invite that
-- row can't exist yet — it's only created by admin.functions.ts *after*
-- inviteUserByEmail succeeds. That's a chicken-and-egg problem that was
-- silently blocking admins from inviting anyone outside the company
-- domain, which defeats the entire point of this feature.
--
-- Fix: admin.functions.ts now tags the invite with
-- user_metadata.invited_by_admin = true when it calls inviteUserByEmail.
-- The hook trusts that flag directly — it's already gated by the
-- has_role(admin) check inside inviteMembers itself, so no separate
-- check is needed here. Self-service sign-ins (Google OAuth, password)
-- never carry that flag, so they still fall through to the original
-- domain / already-invited-profile checks exactly as before.
create or replace function public.hook_restrict_signup_to_invited(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _email text;
  _domain text;
  _invited_by_admin boolean;
  _already_invited boolean;
begin
  _invited_by_admin := coalesce((event->'user'->'user_metadata'->>'invited_by_admin')::boolean, false);
  if _invited_by_admin then
    return '{}'::jsonb;
  end if;

  _email := lower(event->'user'->>'email');
  _domain := split_part(_email, '@', 2);

  if _domain in ('ironbrij.com', 'ironbrij.com.au') then
    return '{}'::jsonb;
  end if;

  select exists (
    select 1 from public.profiles where lower(email) = _email
  ) into _already_invited;

  if _already_invited then
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
