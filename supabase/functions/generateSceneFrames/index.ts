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

const FRAMES_PER_SCENE = 6;
const MIN_FRAMES = 5;
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_BACKOFFS_MS = [2000, 5000];

interface SceneRow {
  id: string;
  project_id: string;
  scene_order: number;
  description: string;
  duration: number;
  status: string;
}

function projectSeed(project_id: string): number {
  // Deterministic seed per project so re-runs reuse the same character identity.
  let h = 2166136261;
  for (let i = 0; i < project_id.length; i++) {
    h ^= project_id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2_147_483_647;
}

async function callColab(
  endpoint: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: true; images: string[] } | { ok: false; reason: string }> {
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
    const images = Array.isArray(data?.images) ? data.images.filter((u: unknown) => typeof u === "string") : [];
    if (images.length < MIN_FRAMES || images.length > FRAMES_PER_SCENE) {
      return { ok: false, reason: `expected ${MIN_FRAMES}-${FRAMES_PER_SCENE} images, got ${images.length}` };
    }
    return { ok: true, images };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown fetch error" };
  } finally {
    clearTimeout(t);
  }
}

async function callColabWithRetry(
  endpoint: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: true; images: string[] } | { ok: false; reason: string }> {
  let last: { ok: false; reason: string } = { ok: false, reason: "no attempts" };
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[attempt - 1]));
    const res = await callColab(endpoint, apiKey, payload);
    if (res.ok) return res;
    last = res;
    console.warn(`generateSceneFrames attempt ${attempt + 1} failed: ${res.reason}`);
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const COLAB_ENDPOINT_URL = Deno.env.get("COLAB_ENDPOINT_URL");
    const COLAB_API_KEY = Deno.env.get("COLAB_API_KEY"); // optional

    const body = await req.json().catch(() => ({}));
    const project_id = typeof body?.project_id === "string" ? body.project_id : null;
    if (!project_id) return json({ error: "project_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Fetch project
    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, status, progress, user_id")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "project not found" }, 404);
    if (project.status !== "generating") {
      return json({ error: `project not in generating state (current: ${project.status})`, skipped: true }, 409);
    }

    const MOCK_MODE = !COLAB_ENDPOINT_URL;
    if (MOCK_MODE) {
      console.log("generateSceneFrames: running in MOCK mode (COLAB_ENDPOINT_URL not set)");
    }

    // 2. Fetch scenes needing work
    const { data: scenes, error: sErr } = await admin
      .from("scenes")
      .select("id, project_id, scene_order, description, duration, status")
      .eq("project_id", project_id)
      .in("status", ["pending", "failed"])
      .order("scene_order", { ascending: true });
    if (sErr) return json({ error: sErr.message }, 500);

    const { data: allScenes } = await admin
      .from("scenes")
      .select("id, status")
      .eq("project_id", project_id);
    const totalScenes = allScenes?.length ?? 0;

    if (!scenes || scenes.length === 0) {
      return json({ success: true, message: "no work", processed_scenes: 0 });
    }

    const seed = projectSeed(project_id);
    let processed = 0;

    for (const scene of scenes as SceneRow[]) {
      // 3. Idempotency check
      const { count: existing } = await admin
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id)
        .eq("type", "frame")
        .eq("metadata->>scene_id", scene.id);

      if ((existing ?? 0) >= MIN_FRAMES) {
        await admin.from("scenes").update({ status: "completed", error_message: null }).eq("id", scene.id);
        processed++;
        continue;
      }

      // Mark scene as generating
      await admin.from("scenes").update({ status: "generating", error_message: null }).eq("id", scene.id);

      // 4. Build payload
      const enhanced_prompt =
        `Same character, same face, same clothing, consistent identity, cinematic, ultra-detailed, ${scene.description}`;
      const negative_prompt =
        "blurry, distorted face, extra limbs, inconsistent identity, low quality";
      const payload = {
        scene_id: scene.id,
        project_id,
        prompt: enhanced_prompt,
        negative_prompt,
        num_images: FRAMES_PER_SCENE,
        width: 768,
        height: 768,
        steps: 25,
        guidance_scale: 7.5,
        seed,
      };

      // 5. Call endpoint with retries (or generate mock URLs)
      const result = MOCK_MODE
        ? {
            ok: true as const,
            images: Array.from({ length: FRAMES_PER_SCENE }, (_, i) =>
              `https://placehold.co/768x768/0f172a/ffffff?text=Scene+${scene.scene_order}+Frame+${i + 1}`,
            ),
          }
        : await callColabWithRetry(COLAB_ENDPOINT_URL!, COLAB_API_KEY, payload);

      if (!result.ok) {
        await admin
          .from("scenes")
          .update({ status: "failed", error_message: `frame_generation: ${result.reason}` })
          .eq("id", scene.id);
        await admin.from("generation_logs").insert({
          project_id,
          step: "frame_generation",
          status: "error",
          message: `scene ${scene.scene_order} failed: ${result.reason}`,
        });
        continue;
      }

      // 6. Persist frames (clear partials first to avoid duplicates)
      await admin
        .from("assets")
        .delete()
        .eq("project_id", project_id)
        .eq("type", "frame")
        .eq("metadata->>scene_id", scene.id);

      const rows = result.images.slice(0, FRAMES_PER_SCENE).map((url, index) => ({
        project_id,
        type: "frame",
        url,
        path: `frames/${scene.id}/${index}`,
        metadata: { scene_id: scene.id, index },
      }));

      const { error: insErr } = await admin.from("assets").insert(rows);
      if (insErr) {
        await admin
          .from("scenes")
          .update({ status: "failed", error_message: `asset insert: ${insErr.message}` })
          .eq("id", scene.id);
        await admin.from("generation_logs").insert({
          project_id,
          step: "frame_generation",
          status: "error",
          message: `scene ${scene.scene_order} insert failed: ${insErr.message}`,
        });
        continue;
      }

      await admin.from("scenes").update({ status: "completed" }).eq("id", scene.id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "frame_generation",
        status: "success",
        message: `scene ${scene.scene_order}: ${rows.length} frames`,
      });
      processed++;

      // 7. Progress 30 -> 70
      const { data: doneCountData } = await admin
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id)
        .eq("status", "completed");
      const completed = (doneCountData as unknown as { length?: number })?.length ?? 0;
      void completed; // count comes from head request below
      const { count: completedCount } = await admin
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id)
        .eq("status", "completed");
      const ratio = totalScenes > 0 ? (completedCount ?? 0) / totalScenes : 0;
      const progress = Math.min(70, Math.max(30, Math.round(30 + ratio * 40)));
      await admin.from("projects").update({ progress }).eq("id", project_id);
    }

    // 8. Completion check
    const { count: completedTotal } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("status", "completed");

    if (totalScenes > 0 && completedTotal === totalScenes) {
      await admin
        .from("projects")
        .update({ status: "frames_ready", progress: 70 })
        .eq("id", project_id);
    }

    return json({ success: true, processed_scenes: processed });
  } catch (e) {
    console.error("generateSceneFrames fatal:", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
