## What's happening

Your project `Navya Noir` is stuck at `status=generating`, `progress=30%`, with all scenes marked `failed`. The latest log entry says:

> `frame_generation: COLAB_ENDPOINT_URL not configured`

### Root cause

Two independent issues compounded:

1. **Old function code is deployed.** The mock-mode fallback we added to `generateSceneFrames`, `buildSceneVideos`, and `stitchProjectVideo` is in your repo but was never redeployed. The live function still hard-fails when `COLAB_ENDPOINT_URL` is missing, instead of using placeholder frames.
2. **No retry path in the UI.** `ProjectDetail.tsx` only renders the "Start generation" button when `project.status === "pending"`. Once a project moves to `generating` and fails, there is no way to re-run the pipeline from the UI — it's permanently stuck.

## Plan

### 1. Redeploy the three pipeline functions
Deploy `generateSceneFrames`, `buildSceneVideos`, and `stitchProjectVideo` so the mock-mode code (already in the repo) is actually live. After this, missing `COLAB_ENDPOINT_URL` / `WORKER_ENDPOINT` / `STITCH_WORKER_ENDPOINT` will produce placeholder frames + a sample MP4 instead of erroring.

### 2. Reset the stuck `Navya Noir` project
One-time SQL update to make it retriable:
- `projects.status = 'pending'`, `progress = 0`, `error_message = null`
- `scenes` for that project: delete them (planScenes will replan), or reset to `status='pending'` and clear `video_url`. Deleting is cleaner because planScenes is now idempotency-guarded.
- Delete any partial `assets` rows of type `frame` for that project.

### 3. Make the UI resilient to retries
Update `src/pages/ProjectDetail.tsx`:
- Show a **"Retry generation"** button whenever `status` is `failed`, or when it's `generating`/`frames_ready`/`clips_ready` AND nothing has progressed for a while (simplest: just always show a "Resume / Retry" button unless `status === 'completed'`).
- The button calls the same `startGeneration()` chain. The functions are already idempotent / state-guarded (planScenes skips if scenes exist, frame gen skips scenes that already have frames, etc.), so re-running is safe.
- Add a small "Reset project" action that, on click, sets status back to `pending`, clears scenes/frames, so the user can start completely fresh after a bad run.

### 4. Verify end-to-end in mock mode
After deploy + reset, click "Start generation" on `Navya Noir`. Expected flow:
- planScenes → 3–5 scenes inserted, progress 25%
- generateSceneFrames → placehold.co frames per scene, progress 70%, status `frames_ready`
- buildSceneVideos → BigBuckBunny sample URL per scene, progress 90%, status `clips_ready`
- stitchProjectVideo → first clip used as `final_video_url`, status `completed`, progress 100%

Final video player in the UI should then show a real (sample) MP4.

### 5. (Optional, after you confirm mock works) Plug in real endpoints
When you have a Colab/ngrok URL and an FFmpeg worker URL, add them as secrets:
- `COLAB_ENDPOINT_URL` (+ optional `COLAB_API_KEY`)
- `WORKER_ENDPOINT` (+ optional `WORKER_API_KEY`)
- `STITCH_WORKER_ENDPOINT` (+ optional `STITCH_WORKER_API_KEY`)

No code change needed — the functions auto-switch out of mock mode once the env vars exist.

## Technical notes

- Deploy uses `supabase--deploy_edge_functions` for the three function names.
- DB reset is a single migration (UPDATE projects + DELETE scenes + DELETE assets where project_id = 'd2d9f9c1-...'). Migrations are required because RLS-bypassing UPDATE/DELETE isn't available via `read_query`.
- The retry button is a tiny addition to the existing `<aside>` in `ProjectDetail.tsx`; no new components needed.
- No schema changes.
