ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_assets_project_type ON public.assets(project_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_metadata_scene ON public.assets((metadata->>'scene_id'));

ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'frames_ready';
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'clips_ready';