-- H11 corollary: none of these edits were audited — activity_log only ever
-- covered approvals, role changes, team membership, and submit/approve/
-- reject, never time-entry edits. Now that Manage > Entries lets a manager/
-- admin edit or delete someone else's time entry (RLS on time_entries
-- already granted this; there was just no UI), those changes need a trail.
--
-- A trigger, not a wrapper RPC, for the same reason team_membership_activity_log
-- exists: updateEntry/deleteEntry are plain client-side .update()/.delete()
-- calls used by both self-editing (the normal, high-frequency case) and this
-- new manager path, and activity_log has no INSERT grant to `authenticated`
-- at all — only SECURITY DEFINER code can write to it. Gating on
-- `auth.uid() IS DISTINCT FROM {NEW,OLD}.user_id` is what keeps this to
-- exactly the manager/admin-on-someone-else's-entry case instead of logging
-- every routine self-edit.
CREATE OR REPLACE FUNCTION public.log_time_entry_edit_by_other()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_edited',
        NEW.user_id,
        jsonb_build_object('entry_id', NEW.id, 'entry_date', NEW.entry_date)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_deleted',
        OLD.user_id,
        jsonb_build_object(
          'entry_id', OLD.id,
          'entry_date', OLD.entry_date,
          'description', OLD.description
        )
      );
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER time_entries_edit_by_other_activity_log
AFTER UPDATE OR DELETE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.log_time_entry_edit_by_other();
