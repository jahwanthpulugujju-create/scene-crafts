DELETE FROM public.assets WHERE project_id = 'd2d9f9c1-aa4d-4741-a2b8-3955f1a8db6e';
DELETE FROM public.scenes WHERE project_id = 'd2d9f9c1-aa4d-4741-a2b8-3955f1a8db6e';
UPDATE public.projects
SET status = 'pending', progress = 0, error_message = NULL, final_video_url = NULL
WHERE id = 'd2d9f9c1-aa4d-4741-a2b8-3955f1a8db6e';