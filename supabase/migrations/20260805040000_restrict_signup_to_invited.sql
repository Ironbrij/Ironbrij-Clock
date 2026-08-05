-- Replaces the flawed "any @gmail.com address is allowed" domain
-- allowlist with the actual rule Louis needs: your company domain is
-- always fine, and anyone else (personal Gmail, etc.) is only allowed
-- if an admin has already invited that *specific* address. Invites
-- already create a profiles row up front (see inviteMembers in
-- admin.functions.ts), before the person ever signs in — so "does a
-- profiles row already exist for this email" is exactly the right test.
--
-- This is wired up as a Supabase "Before User Created" Auth Hook, which
-- runs on every new-account attempt regardless of method (Google OAuth
-- or email/password) — it runs before the account is created, so a
-- rejected signup never creates an auth.users row and never gets a
-- session at all. This function alone does nothing until it's enabled
-- as that hook in the Supabase dashboard — see the deploy notes.
create or replace function public.hook_restrict_signup_to_invited(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _email text;
  _domain text;
  _already_invited boolean;
begin
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

-- Auth Hooks are called by Supabase's internal auth service role, not by
-- normal app users — matching the pattern in Supabase's own docs for
-- this feature exactly.
grant execute on function public.hook_restrict_signup_to_invited(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_to_invited(jsonb) from authenticated, anon, public;
