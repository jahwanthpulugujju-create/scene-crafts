
-- Fix search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Lock down user_owns_project execution
REVOKE EXECUTE ON FUNCTION public.user_owns_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_owns_project(UUID) TO authenticated;

-- Replace broad bucket SELECT with read-only file access (no listing for anon)
DROP POLICY IF EXISTS "media public read" ON storage.objects;
CREATE POLICY "media public read files" ON storage.objects FOR SELECT
  USING (bucket_id = 'media');
