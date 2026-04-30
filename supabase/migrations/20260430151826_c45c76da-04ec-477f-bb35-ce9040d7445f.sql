-- Unique scene_order per project
CREATE UNIQUE INDEX IF NOT EXISTS scenes_project_order_unique
  ON public.scenes (project_id, scene_order);

-- Duration bounds (5-8 seconds)
ALTER TABLE public.scenes
  DROP CONSTRAINT IF EXISTS scenes_duration_range;
ALTER TABLE public.scenes
  ADD CONSTRAINT scenes_duration_range CHECK (duration BETWEEN 5 AND 8);
