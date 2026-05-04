UPDATE public.projects
SET final_video_url = 'https://download.samplelib.com/mp4/sample-5s.mp4'
WHERE final_video_url = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

UPDATE public.scenes
SET video_url = 'https://download.samplelib.com/mp4/sample-5s.mp4'
WHERE video_url = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

UPDATE public.assets
SET url = 'https://download.samplelib.com/mp4/sample-5s.mp4'
WHERE url = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';