import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_BACKOFFS_MS = [2000, 5000];
const CLIP_FPS = 6;

interface SceneRow {
  id: string;
  scene_order: number;
  duration: number;
  status: string;
  video_url: string | null;
}

interface FrameAsset {
  url: string | null;
  metadata: { scene_id?: string; index?: number } | null;
}

async function callWorker(
  endpoint: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: true; video_url: string } | { ok: false; reason: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, reason: `HTTP ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const data = await resp.json().catch(() => null);
    const video_url = typeof data?.video_url === "string" ? data.video_url : "";
    if (!video_url) return { ok: false, reason: "no video_url in response" };
    return { ok: true, video_url };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown fetch error" };
  } finally {
    clearTimeout(t);
  }
}

async function callWorkerWithRetry(
  endpoint: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: true; video_url: string } | { ok: false; reason: string }> {
  let last: { ok: false; reason: string } = { ok: false, reason: "no attempts" };
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[attempt - 1]));
    const res = await callWorker(endpoint, apiKey, payload);
    if (res.ok) return res;
    last = res;
    console.warn(`buildSceneVideos attempt ${attempt + 1} failed: ${res.reason}`);
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const WORKER_ENDPOINT = Deno.env.get("WORKER_ENDPOINT");
    const WORKER_API_KEY = Deno.env.get("WORKER_API_KEY"); // optional

    const body = await req.json().catch(() => ({}));
    const project_id = typeof body?.project_id === "string" ? body.project_id : null;
    if (!project_id) return json({ error: "project_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch project
    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, status, progress")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "project not found" }, 404);
    if (!["frames_ready", "generating"].includes(project.status)) {
      return json({ error: `project not in frames_ready state (current: ${project.status})`, skipped: true }, 409);
    }

    if (!WORKER_ENDPOINT) {
      await admin.from("generation_logs").insert({
        project_id,
        step: "build_clips",
        status: "error",
        message: "WORKER_ENDPOINT not configured",
      });
      return json({ error: "WORKER_ENDPOINT not configured. Add the secret to enable clip building." }, 503);
    }

    // Fetch scenes that need clips
    const { data: scenes, error: sErr } = await admin
      .from("scenes")
      .select("id, scene_order, duration, status, video_url")
      .eq("project_id", project_id)
      .eq("status", "completed")
      .is("video_url", null)
      .order("scene_order", { ascending: true });
    if (sErr) return json({ error: sErr.message }, 500);

    const { data: allScenes } = await admin
      .from("scenes")
      .select("id, video_url")
      .eq("project_id", project_id);
    const totalScenes = allScenes?.length ?? 0;

    if (!scenes || scenes.length === 0) {
      // Maybe everything is already built — re-check completion below
    }

    let processed = 0;

    for (const scene of (scenes ?? []) as SceneRow[]) {
      // Fetch frames for this scene, ordered by index
      const { data: frames, error: fErr } = await admin
        .from("assets")
        .select("url, metadata")
        .eq("project_id", project_id)
        .eq("type", "frame")
        .eq("metadata->>scene_id", scene.id);

      if (fErr || !frames || frames.length === 0) {
        await admin.from("generation_logs").insert({
          project_id,
          step: "build_clips",
          status: "error",
          message: `scene ${scene.scene_order}: no frames found`,
        });
        continue;
      }

      const ordered = (frames as FrameAsset[])
        .filter((f) => typeof f.url === "string")
        .sort((a, b) => Number(a.metadata?.index ?? 0) - Number(b.metadata?.index ?? 0))
        .map((f) => f.url as string);

      const payload = {
        scene_id: scene.id,
        project_id,
        frames: ordered,
        fps: CLIP_FPS,
        duration: scene.duration,
      };

      const result = await callWorkerWithRetry(WORKER_ENDPOINT, WORKER_API_KEY, payload);

      if (!result.ok) {
        await admin.from("generation_logs").insert({
          project_id,
          step: "build_clips",
          status: "error",
          message: `scene ${scene.scene_order} failed: ${result.reason}`,
        });
        continue;
      }

      await admin
        .from("scenes")
        .update({ video_url: result.video_url })
        .eq("id", scene.id);

      await admin.from("generation_logs").insert({
        project_id,
        step: "build_clips",
        status: "success",
        message: `scene ${scene.scene_order} clip built`,
      });
      processed++;

      // Progress 70 -> 90
      const { count: withVideo } = await admin
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id)
        .not("video_url", "is", null);
      const ratio = totalScenes > 0 ? (withVideo ?? 0) / totalScenes : 0;
      const progress = Math.min(90, Math.max(70, Math.round(70 + ratio * 20)));
      await admin.from("projects").update({ progress }).eq("id", project_id);
    }

    // Completion check
    const { count: withVideoTotal } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .not("video_url", "is", null);

    if (totalScenes > 0 && withVideoTotal === totalScenes) {
      await admin
        .from("projects")
        .update({ status: "clips_ready", progress: 90 })
        .eq("id", project_id);
    }

    return json({ success: true, processed_scenes: processed });
  } catch (e) {
    console.error("buildSceneVideos fatal:", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
