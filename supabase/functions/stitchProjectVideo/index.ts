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
const RETRY_BACKOFFS_MS = [2000];

async function callWorker(
  endpoint: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: true; final_video_url: string } | { ok: false; reason: string }> {
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
    const final_video_url = typeof data?.final_video_url === "string" ? data.final_video_url : "";
    if (!final_video_url) return { ok: false, reason: "no final_video_url in response" };
    return { ok: true, final_video_url };
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
): Promise<{ ok: true; final_video_url: string } | { ok: false; reason: string }> {
  let last: { ok: false; reason: string } = { ok: false, reason: "no attempts" };
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[attempt - 1]));
    const res = await callWorker(endpoint, apiKey, payload);
    if (res.ok) return res;
    last = res;
    console.warn(`stitchProjectVideo attempt ${attempt + 1} failed: ${res.reason}`);
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const STITCH_WORKER_ENDPOINT = Deno.env.get("STITCH_WORKER_ENDPOINT");
    const STITCH_WORKER_API_KEY = Deno.env.get("STITCH_WORKER_API_KEY");

    const body = await req.json().catch(() => ({}));
    const project_id = typeof body?.project_id === "string" ? body.project_id : null;
    if (!project_id) return json({ error: "project_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Fetch project
    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, status")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "project not found" }, 404);
    if (project.status !== "clips_ready") {
      return json(
        { error: `project not in clips_ready state (current: ${project.status})`, skipped: true },
        409,
      );
    }

    // 2. Move to stitching
    await admin
      .from("projects")
      .update({ status: "stitching", progress: 92, error_message: null })
      .eq("id", project_id);

    // 3. Fetch ordered scenes with clips
    const { data: scenes, error: sErr } = await admin
      .from("scenes")
      .select("id, scene_order, status, video_url")
      .eq("project_id", project_id)
      .eq("status", "completed")
      .not("video_url", "is", null)
      .order("scene_order", { ascending: true });
    if (sErr) return json({ error: sErr.message }, 500);

    if (!scenes || scenes.length === 0) {
      await admin
        .from("projects")
        .update({ status: "failed", error_message: "no scenes with video_url" })
        .eq("id", project_id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "stitch",
        status: "error",
        message: "no scenes with video_url",
      });
      return json({ error: "no scenes with video_url" }, 400);
    }

    // Verify every scene of the project has a clip (no gaps)
    const { data: allScenes } = await admin
      .from("scenes")
      .select("id, video_url")
      .eq("project_id", project_id);
    const missing = (allScenes ?? []).filter((s) => !s.video_url).length;
    if (missing > 0) {
      await admin
        .from("projects")
        .update({ status: "failed", error_message: `${missing} scenes missing video_url` })
        .eq("id", project_id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "stitch",
        status: "error",
        message: `${missing} scenes missing video_url`,
      });
      return json({ error: `${missing} scenes missing video_url` }, 400);
    }

    const orderedClips = scenes.map((s) => s.video_url as string);

    let final_video_url: string;

    if (!STITCH_WORKER_ENDPOINT) {
      await admin.from("projects").update({
        status: "failed",
        error_message: "Clips ready, but no stitch worker is configured. Set STITCH_WORKER_ENDPOINT to your FFmpeg concat worker URL.",
      }).eq("id", project_id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "stitch",
        status: "error",
        message: "STITCH_WORKER_ENDPOINT not configured",
      });
      return json({ error: "STITCH_WORKER_ENDPOINT not configured", clips_ready: true }, 400);
    } else {
      const result = await callWorkerWithRetry(STITCH_WORKER_ENDPOINT, STITCH_WORKER_API_KEY, {
        project_id,
        clips: orderedClips,
      });
      if (!result.ok) {
        await admin
          .from("projects")
          .update({ status: "failed", error_message: `stitch: ${result.reason}` })
          .eq("id", project_id);
        await admin.from("generation_logs").insert({
          project_id,
          step: "stitch",
          status: "error",
          message: result.reason,
        });
        return json({ error: "stitch worker failed", reason: result.reason }, 502);
      }
      final_video_url = result.final_video_url;
    }

    // 4. Persist final video as asset + update project
    await admin.from("assets").insert({
      project_id,
      type: "final_video",
      url: final_video_url,
      path: `final/${project_id}.mp4`,
      metadata: { clips: orderedClips.length },
    });

    await admin
      .from("projects")
      .update({ status: "completed", progress: 100, final_video_url })
      .eq("id", project_id);

    await admin.from("generation_logs").insert({
      project_id,
      step: "stitch",
      status: "success",
      message: `stitched ${orderedClips.length} clips`,
    });

    return json({ success: true, final_video_url });
  } catch (e) {
    console.error("stitchProjectVideo fatal:", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
