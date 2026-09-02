-- ============ enums & helpers ============
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'member');

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  job_title text,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  role public.app_role NOT NULL DEFAULT 'member',
  is_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.profiles TO authenticated;
GRANT UPDATE (email, full_name, avatar_url, job_title, timezone, is_pending) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.can_manage(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role IN ('admin','manager'));
$$;

CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- role changes are admin-only, via this function (column UPDATE grant excludes role)
CREATE OR REPLACE FUNCTION public.set_member_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  UPDATE public.profiles SET role = _role WHERE id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.app_role) TO authenticated;

-- ============ teams ============
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'oklch(0.62 0.15 256)',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_select_all" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_write_manage" ON public.teams FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_members_select_all" ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_members_write_manage" ON public.team_members FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE OR REPLACE FUNCTION public.shares_team(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members ta
    JOIN public.team_members tb ON tb.team_id = ta.team_id
    WHERE ta.user_id = _a AND tb.user_id = _b
  );
$$;

-- ============ clients / projects / tags ============
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_select_all" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients_write_manage" ON public.clients FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'oklch(0.62 0.15 256)',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select_all" ON public.tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "tags_write_manage" ON public.tags FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  color text NOT NULL DEFAULT 'oklch(0.62 0.15 256)',
  is_billable boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_select_all" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_write_manage" ON public.projects FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_members_select_all" ON public.project_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_members_write_manage" ON public.project_members FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

CREATE TABLE public.project_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  UNIQUE (project_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tags TO authenticated;
GRANT ALL ON public.project_tags TO service_role;
ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_tags_select_all" ON public.project_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_tags_write_manage" ON public.project_tags FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));

-- ============ time entries ============
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  task text,
  description text NOT NULL DEFAULT '',
  tag_ids uuid[] NOT NULL DEFAULT '{}',
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  entry_date date NOT NULL DEFAULT (now())::date,
  duration_minutes integer,
  is_billable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_user_date_idx ON public.time_entries (user_id, entry_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );
CREATE POLICY "time_entries_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );
CREATE POLICY "time_entries_update" ON public.time_entries FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );
CREATE POLICY "time_entries_delete" ON public.time_entries FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );

-- ============ workspace settings ============
CREATE TABLE public.workspace_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  company_name text NOT NULL DEFAULT 'Ironbrij',
  logo_url text,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  weekly_hours numeric NOT NULL DEFAULT 37.5,
  currency text NOT NULL DEFAULT 'AUD',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.workspace_settings TO authenticated;
GRANT ALL ON public.workspace_settings TO service_role;
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select_all" ON public.workspace_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write_admin" ON public.workspace_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ aggregate views (no PII) ============
CREATE VIEW public.project_hours AS
  SELECT p.id AS project_id,
         COALESCE(SUM(te.duration_minutes), 0)::int AS total_minutes,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= date_trunc('week', now())::date
             AND te.entry_date < (date_trunc('week', now()) + interval '7 days')::date
         ), 0)::int AS week_minutes
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
GRANT SELECT ON public.project_hours TO authenticated;

CREATE VIEW public.tag_usage AS
  SELECT t.id AS tag_id, COUNT(te.id)::int AS entry_count
  FROM public.tags t
  LEFT JOIN public.time_entries te ON t.id = ANY (te.tag_ids)
  GROUP BY t.id;
GRANT SELECT ON public.tag_usage TO authenticated;

-- ============ seed data ============
INSERT INTO public.workspace_settings (id, company_name, timezone, weekly_hours, currency)
VALUES (true, 'Ironbrij / Virtual Assistant Australia', 'Australia/Sydney', 37.5, 'AUD');

INSERT INTO public.teams (id, name, color) VALUES
 ('a0000000-0000-4000-8000-000000000001','Web Development','oklch(0.62 0.15 256)'),
 ('a0000000-0000-4000-8000-000000000002','Design Studio','oklch(0.65 0.16 320)'),
 ('a0000000-0000-4000-8000-000000000003','SEO & Content','oklch(0.68 0.15 145)'),
 ('a0000000-0000-4000-8000-000000000004','Paid Media','oklch(0.7 0.16 60)'),
 ('a0000000-0000-4000-8000-000000000005','VA Operations','oklch(0.6 0.15 25)'),
 ('a0000000-0000-4000-8000-000000000006','Client Support','oklch(0.66 0.13 200)'),
 ('a0000000-0000-4000-8000-000000000007','Finance','oklch(0.55 0.1 280)'),
 ('a0000000-0000-4000-8000-000000000008','People & Culture','oklch(0.7 0.14 35)'),
 ('a0000000-0000-4000-8000-000000000009','Recruitment','oklch(0.63 0.14 170)'),
 ('a0000000-0000-4000-8000-00000000000a','Sales','oklch(0.6 0.17 300)'),
 ('a0000000-0000-4000-8000-00000000000b','Social Media','oklch(0.68 0.16 15)'),
 ('a0000000-0000-4000-8000-00000000000c','Data & Automation','oklch(0.58 0.12 230)'),
 ('a0000000-0000-4000-8000-00000000000d','Quality Assurance','oklch(0.64 0.12 110)');

INSERT INTO public.profiles (id, email, full_name, job_title, role) VALUES
 ('b0000000-0000-4000-8000-000000000001','maya@ironbrij.com','Maya Alvarez','Head of Delivery','admin'),
 ('b0000000-0000-4000-8000-000000000002','tom@ironbrij.com','Tom Whitfield','Lead Engineer','manager'),
 ('b0000000-0000-4000-8000-000000000003','priya@ironbrij.com','Priya Nandakumar','Frontend Developer','member'),
 ('b0000000-0000-4000-8000-000000000004','jonas@ironbrij.com','Jonas Meyer','Design Lead','manager'),
 ('b0000000-0000-4000-8000-000000000005','aisha@ironbrij.com','Aisha Rahman','Product Designer','member'),
 ('b0000000-0000-4000-8000-000000000006','liam@ironbrij.com','Liam O''Connor','SEO Strategist','manager'),
 ('b0000000-0000-4000-8000-000000000007','chelsea@ironbrij.com','Chelsea Reyes','Content Writer','member'),
 ('b0000000-0000-4000-8000-000000000008','daniel@ironbrij.com','Daniel Kim','VA Team Lead','manager'),
 ('b0000000-0000-4000-8000-000000000009','grace@ironbrij.com','Grace Mwangi','Executive Assistant','member'),
 ('b0000000-0000-4000-8000-00000000000a','sofia@ironbrij.com','Sofia Ricci','Support Specialist','member');

INSERT INTO public.team_members (user_id, team_id) VALUES
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000002'),
 ('b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000002'),
 ('b0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000003'),
 ('b0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000003'),
 ('b0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000005'),
 ('b0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000005'),
 ('b0000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-000000000006');

INSERT INTO public.clients (id, name) VALUES
 ('c0000000-0000-4000-8000-000000000001','Northshore Dental'),
 ('c0000000-0000-4000-8000-000000000002','Harbourview Legal'),
 ('c0000000-0000-4000-8000-000000000003','Bluegum Health');

INSERT INTO public.tags (id, name, color) VALUES
 ('d0000000-0000-4000-8000-000000000001','Billable','oklch(0.62 0.15 256)'),
 ('d0000000-0000-4000-8000-000000000002','Internal','oklch(0.58 0.12 230)'),
 ('d0000000-0000-4000-8000-000000000003','Urgent','oklch(0.6 0.17 25)'),
 ('d0000000-0000-4000-8000-000000000004','Meeting','oklch(0.65 0.16 320)'),
 ('d0000000-0000-4000-8000-000000000005','Overtime','oklch(0.7 0.16 60)'),
 ('d0000000-0000-4000-8000-000000000006','Training','oklch(0.68 0.15 145)');

INSERT INTO public.projects (id, name, client_id, team_id, color, is_billable) VALUES
 ('e0000000-0000-4000-8000-000000000001','Northshore Dental Rebuild','c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','oklch(0.62 0.15 256)',true),
 ('e0000000-0000-4000-8000-000000000002','Harbourview Brand Refresh','c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','oklch(0.65 0.16 320)',true),
 ('e0000000-0000-4000-8000-000000000003','Q3 Content Engine','c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','oklch(0.68 0.15 145)',true),
 ('e0000000-0000-4000-8000-000000000004','VA Onboarding Program',NULL,'a0000000-0000-4000-8000-000000000005','oklch(0.6 0.15 25)',false),
 ('e0000000-0000-4000-8000-000000000005','Client Support Desk',NULL,'a0000000-0000-4000-8000-000000000006','oklch(0.66 0.13 200)',false),
 ('e0000000-0000-4000-8000-000000000006','Ironbrij Time (this app)',NULL,'a0000000-0000-4000-8000-00000000000c','oklch(0.58 0.12 230)',false);

INSERT INTO public.project_members (project_id, user_id) VALUES
 ('e0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003'),
 ('e0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004'),
 ('e0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000005'),
 ('e0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000006'),
 ('e0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000007'),
 ('e0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000008'),
 ('e0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000009'),
 ('e0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-00000000000a'),
 ('e0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000008'),
 ('e0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000005'),
 ('e0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000003');

INSERT INTO public.project_tags (project_id, tag_id) VALUES
 ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000002');

-- Anchored 7 days back from whenever this migration actually runs (not
-- "start of this calendar week") so day_index 0-4 always lands safely in
-- the past no matter which day of the week a fresh replay happens to hit —
-- a later migration (20260812040000) adds a "no more than 1 day in the
-- future" CHECK constraint on start_time, and the original "start of this
-- week" anchor could put a Thursday/Friday seed row several days ahead of
-- "now" if replayed early in the week, violating that constraint on a
-- from-scratch apply (exactly what a CI run doing `supabase start` does;
-- never an issue against the one already-migrated production database,
-- where this only ever ran once, back when it was written).
INSERT INTO public.time_entries (user_id, project_id, task, description, tag_ids, start_time, end_time, entry_date, duration_minutes, is_billable)
SELECT
  v.user_id::uuid,
  v.project_id::uuid,
  v.task,
  v.description,
  ARRAY[v.tag_id::uuid],
  (date_trunc('day', now()) - interval '7 days' + (v.day_index || ' days')::interval + (v.start_hour || ' minutes')::interval),
  (date_trunc('day', now()) - interval '7 days' + (v.day_index || ' days')::interval + (v.start_hour || ' minutes')::interval + (v.minutes || ' minutes')::interval),
  (date_trunc('day', now()) - interval '7 days' + (v.day_index || ' days')::interval)::date,
  v.minutes,
  v.billable
FROM (VALUES
 ('b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','Development','Sprint kickoff + ticket grooming','d0000000-0000-4000-8000-000000000001',0,510,210,true),
 ('b0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000003','Research','Competitor content audit','d0000000-0000-4000-8000-000000000001',0,780,120,true),
 ('b0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000002','Design','Logo lockup variations','d0000000-0000-4000-8000-000000000001',0,930,60,true),
 ('b0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001','Development','Appointment API integration','d0000000-0000-4000-8000-000000000001',1,540,240,true),
 ('b0000000-0000-4000-8000-000000000008','e0000000-0000-4000-8000-000000000004','Admin','Onboarding checklist rewrite','d0000000-0000-4000-8000-000000000002',1,840,120,false),
 ('b0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000006','Design','Dashboard timer concepts','d0000000-0000-4000-8000-000000000002',2,555,120,false),
 ('b0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001','QA & testing','Cross-browser pass','d0000000-0000-4000-8000-000000000001',2,690,150,true),
 ('b0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-000000000005','Client call','Escalation review','d0000000-0000-4000-8000-000000000004',2,900,60,false),
 ('b0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000006','Design','Timesheet grid explorations','d0000000-0000-4000-8000-000000000002',3,735,130,false),
 ('b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','Development','Booking flow validation states','d0000000-0000-4000-8000-000000000001',3,545,95,true),
 ('b0000000-0000-4000-8000-000000000007','e0000000-0000-4000-8000-000000000003','Development','Blog template performance fixes','d0000000-0000-4000-8000-000000000001',4,600,120,true),
 ('b0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-000000000005','Admin','Support queue triage','d0000000-0000-4000-8000-000000000002',4,780,120,false)
) AS v(user_id, project_id, task, description, tag_id, day_index, start_hour, minutes, billable);