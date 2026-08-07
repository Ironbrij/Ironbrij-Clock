-- Lets clients be marked active/inactive without deleting them — losing a
-- client record would also lose its name on any historical project it's
-- attached to. Defaults every existing client to active, so nothing
-- changes for anyone until someone explicitly deactivates one.
ALTER TABLE public.clients ADD COLUMN is_active boolean NOT NULL DEFAULT true;
