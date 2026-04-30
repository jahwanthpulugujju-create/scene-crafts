
-- Status enums
CREATE TYPE public.project_status AS ENUM ('pending','planning','generating','stitching','completed','failed');
CREATE TYPE public.scene_status AS ENUM ('pending','generating','completed','failed');

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  style TEXT,
  target_duration INTEGER NOT NULL DEFAULT 60,
  status public.project_status NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  character_image_url TEXT,
  final_video_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user ON public.projects(user_id, created_at DESC);

-- Scenes
CREATE TABLE public.scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  action TEXT,
  environment TEXT,
  camera TEXT,
  mood TEXT,
  duration INTEGER NOT NULL DEFAULT 6,
  status public.scene_status NOT NULL DEFAULT 'pending',
  video_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenes_project ON public.scenes(project_id, scene_order);

-- Assets
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_project ON public.assets(project_id);

-- Generation logs
CREATE TABLE public.generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_project ON public.generation_logs(project_id, created_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_scenes_touch BEFORE UPDATE ON public.scenes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "own projects select" ON public.projects FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own projects insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own projects update" ON public.projects FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own projects delete" ON public.projects FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Helper: project belongs to user
CREATE OR REPLACE FUNCTION public.user_owns_project(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = auth.uid());
$$;

-- Scenes policies
CREATE POLICY "scenes select" ON public.scenes FOR SELECT TO authenticated USING (public.user_owns_project(project_id));
CREATE POLICY "scenes insert" ON public.scenes FOR INSERT TO authenticated WITH CHECK (public.user_owns_project(project_id));
CREATE POLICY "scenes update" ON public.scenes FOR UPDATE TO authenticated USING (public.user_owns_project(project_id));
CREATE POLICY "scenes delete" ON public.scenes FOR DELETE TO authenticated USING (public.user_owns_project(project_id));

-- Assets policies
CREATE POLICY "assets select" ON public.assets FOR SELECT TO authenticated USING (public.user_owns_project(project_id));
CREATE POLICY "assets insert" ON public.assets FOR INSERT TO authenticated WITH CHECK (public.user_owns_project(project_id));
CREATE POLICY "assets update" ON public.assets FOR UPDATE TO authenticated USING (public.user_owns_project(project_id));
CREATE POLICY "assets delete" ON public.assets FOR DELETE TO authenticated USING (public.user_owns_project(project_id));

-- Logs policies
CREATE POLICY "logs select" ON public.generation_logs FOR SELECT TO authenticated USING (public.user_owns_project(project_id));
CREATE POLICY "logs insert" ON public.generation_logs FOR INSERT TO authenticated WITH CHECK (public.user_owns_project(project_id));

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('media','media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (per-user folder: media/<user_id>/...)
CREATE POLICY "media public read" ON storage.objects FOR SELECT USING (bucket_id = 'media');
CREATE POLICY "media own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "media own update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "media own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
