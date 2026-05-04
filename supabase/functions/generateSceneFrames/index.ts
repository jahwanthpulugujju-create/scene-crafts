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
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

interface SceneRow {
  id: string;
  project_id: string;
  scene_order: number;
  description: string;
  action: string | null;
  environment: string | null;
  camera: string | null;
  mood: string | null;
  duration: number;
  status: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
  status: string;
  prompt: string;
  style: string | null;
  character_image_url: string | null;
}

/** Strip a data: URL prefix if present and return raw base64 + mime. */
function parseDataUrl(s: string): { mime: string; b64: string } | null {
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Call Lovable AI image model, return one image as bytes. */
async function generateOneFrame(
  apiKey: string,
  prompt: string,
): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }> {
  try {
    const resp = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (resp.status === 429) return { ok: false, reason: "rate_limited" };
    if (resp.status === 402) return { ok: false, reason: "payment_required" };
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return { ok: false, reason: `gateway ${resp.status}: ${t.slice(0, 200)}` };
    }
    const data = await resp.json();
    // The image model returns images in choices[0].message.images[0].image_url.url as a data: URL.
    const choice = data?.choices?.[0]?.message;
    const imgUrl: string | undefined =
      choice?.images?.[0]?.image_url?.url ?? choice?.images?.[0]?.url;
    if (!imgUrl) return { ok: false, reason: "no image in response" };

    const parsed = parseDataUrl(imgUrl);
    if (parsed) {
      return { ok: true, bytes: b64ToBytes(parsed.b64), mime: parsed.mime };
    }
    // Fallback: it's an http(s) URL — fetch the bytes
    const r = await fetch(imgUrl);
    if (!r.ok) return { ok: false, reason: `fetch image ${r.status}` };
    const buf = new Uint8Array(await r.arrayBuffer());
    return { ok: true, bytes: buf, mime: r.headers.get("content-type") ?? "image/png" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

function buildScenePrompt(project: ProjectRow, scene: SceneRow, frameIndex: number, totalFrames: number): string {
  const stylePart = project.style ? `Style: ${project.style}.` : "";
  const characterPart = project.character_image_url
    ? "Maintain the EXACT same main character (face, hair, clothing, body type) consistent across every frame and every scene of this project."
    : "Maintain a single consistent main character (face, hair, clothing) across every frame and scene.";
  const beat = `Frame ${frameIndex + 1} of ${totalFrames} in this scene — capture the moment progressing slightly forward in time, like a movie storyboard panel.`;

  return [
    `Cinematic film still. ${stylePart}`,
    `Project concept: ${project.prompt}`,
    `Scene ${scene.scene_order}: ${scene.description}`,
    scene.action ? `Action: ${scene.action}.` : "",
    scene.environment ? `Environment: ${scene.environment}.` : "",
    scene.camera ? `Camera: ${scene.camera}.` : "",
    scene.mood ? `Mood: ${scene.mood}.` : "",
    characterPart,
    beat,
    "High detail, natural lighting, no text, no watermarks, 16:9 framing.",
  ]
    .filter(Boolean)
    .join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const project_id = typeof body?.project_id === "string" ? body.project_id : null;
    if (!project_id) return json({ error: "project_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, user_id, status, prompt, style, character_image_url")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "project not found" }, 404);
    if (project.status !== "generating") {
      return json({ error: `project not in generating state (current: ${project.status})`, skipped: true }, 409);
    }

    const { data: scenes, error: sErr } = await admin
      .from("scenes")
      .select("id, project_id, scene_order, description, action, environment, camera, mood, duration, status")
      .eq("project_id", project_id)
      .in("status", ["pending", "failed"])
      .order("scene_order", { ascending: true });
    if (sErr) return json({ error: sErr.message }, 500);

    const { count: totalScenes } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id);

    if (!scenes || scenes.length === 0) {
      return json({ success: true, message: "no work", processed_scenes: 0 });
    }

    let processed = 0;
    let rateLimited = false;
    let paymentRequired = false;

    for (const scene of scenes as SceneRow[]) {
      // Idempotency: skip if already has enough frames
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

      await admin.from("scenes").update({ status: "generating", error_message: null }).eq("id", scene.id);

      // Clear partial frames for clean retry
      await admin
        .from("assets")
        .delete()
        .eq("project_id", project_id)
        .eq("type", "frame")
        .eq("metadata->>scene_id", scene.id);

      const generated: { url: string; index: number }[] = [];
      let sceneFailed: string | null = null;

      for (let i = 0; i < FRAMES_PER_SCENE; i++) {
        const prompt = buildScenePrompt(project as ProjectRow, scene, i, FRAMES_PER_SCENE);
        const result = await generateOneFrame(LOVABLE_API_KEY, prompt);
        if (!result.ok) {
          if (result.reason === "rate_limited") rateLimited = true;
          if (result.reason === "payment_required") paymentRequired = true;
          sceneFailed = result.reason;
          break;
        }
        // Upload to media bucket
        const ext = result.mime.includes("jpeg") ? "jpg" : "png";
        const path = `frames/${project.user_id}/${project_id}/${scene.id}/${i}.${ext}`;
        const { error: upErr } = await admin.storage
          .from("media")
          .upload(path, result.bytes, { contentType: result.mime, upsert: true });
        if (upErr) {
          sceneFailed = `upload: ${upErr.message}`;
          break;
        }
        const { data: pub } = admin.storage.from("media").getPublicUrl(path);
        generated.push({ url: pub.publicUrl, index: i });
      }

      if (sceneFailed || generated.length < MIN_FRAMES) {
        const reason = sceneFailed ?? `only ${generated.length} frames generated`;
        await admin
          .from("scenes")
          .update({ status: "failed", error_message: `frame_generation: ${reason}` })
          .eq("id", scene.id);
        await admin.from("generation_logs").insert({
          project_id,
          step: "frame_generation",
          status: "error",
          message: `scene ${scene.scene_order} failed: ${reason}`,
        });
        if (rateLimited || paymentRequired) break; // stop the whole run early
        continue;
      }

      const rows = generated.map((g) => ({
        project_id,
        type: "frame",
        url: g.url,
        path: `frames/${scene.id}/${g.index}`,
        metadata: { scene_id: scene.id, index: g.index },
      }));

      const { error: insErr } = await admin.from("assets").insert(rows);
      if (insErr) {
        await admin
          .from("scenes")
          .update({ status: "failed", error_message: `asset insert: ${insErr.message}` })
          .eq("id", scene.id);
        continue;
      }

      await admin.from("scenes").update({ status: "completed" }).eq("id", scene.id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "frame_generation",
        status: "success",
        message: `scene ${scene.scene_order}: ${rows.length} AI frames`,
      });
      processed++;

      // Progress 30 -> 70
      const { count: completedCount } = await admin
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id)
        .eq("status", "completed");
      const ratio = (totalScenes ?? 0) > 0 ? (completedCount ?? 0) / (totalScenes ?? 1) : 0;
      const progress = Math.min(70, Math.max(30, Math.round(30 + ratio * 40)));
      await admin.from("projects").update({ progress }).eq("id", project_id);
    }

    if (paymentRequired) {
      await admin.from("projects").update({
        status: "failed",
        error_message: "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage.",
      }).eq("id", project_id);
      return json({ error: "payment_required" }, 402);
    }
    if (rateLimited) {
      await admin.from("projects").update({
        status: "failed",
        error_message: "Lovable AI rate limit hit. Wait a minute and retry.",
      }).eq("id", project_id);
      return json({ error: "rate_limited" }, 429);
    }

    // Completion check
    const { count: completedTotal } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("status", "completed");

    if ((totalScenes ?? 0) > 0 && completedTotal === totalScenes) {
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
