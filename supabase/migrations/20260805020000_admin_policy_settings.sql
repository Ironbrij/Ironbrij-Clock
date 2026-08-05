-- Backing columns for the two Admin toggles that are becoming real
-- ("Lock timesheets after approval" isn't here on purpose — that one's
-- being removed as a toggle entirely, since it already happens
-- unconditionally as of the approval-workflow migration, and making it
-- optional would undermine the point of approval).
ALTER TABLE public.workspace_settings
  ADD COLUMN require_descriptions boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_manual_entry boolean NOT NULL DEFAULT true;
