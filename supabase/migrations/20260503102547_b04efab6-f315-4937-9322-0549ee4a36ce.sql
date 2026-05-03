-- Prevent duplicate frame assets for the same scene+index
CREATE UNIQUE INDEX IF NOT EXISTS assets_unique_frame_per_scene_idx
ON public.assets (project_id, type, path)
WHERE type = 'frame';

-- Helpful index for logs panel queries
CREATE INDEX IF NOT EXISTS generation_logs_project_created_idx
ON public.generation_logs (project_id, created_at DESC);