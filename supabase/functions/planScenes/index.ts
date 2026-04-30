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

interface PlannedScene {
  scene_order: number;
  description: string;
  duration: number;
}

const CAMERA_KEYWORDS = [
  "wide", "close-up", "closeup", "close up", "tracking", "over-the-shoulder",
  "over the shoulder", "medium shot", "long shot", "aerial", "pan", "dolly",
  "crane", "handheld", "low angle", "high angle", "establishing", "pov",
  "point of view", "tilt", "zoom",
];

const LIGHTING_KEYWORDS = [
  "light", "lit", "lighting", "shadow", "glow", "backlit", "silhouette",
  "sunlit", "moonlit", "neon", "golden hour", "rim light", "soft light",
  "harsh light", "dim", "bright", "flicker", "candlelight", "spotlight",
  "overcast", "sunset", "sunrise", "dusk", "dawn",
];

function sceneCountFor(duration: number): number {
  if (duration >= 60) return 5;
  if (duration >= 30) return 4;
  return 3;
}

function deriveCharacterAndActions(prompt: string): {
  main_character: string;
  key_actions: string;
} {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  const firstSentence = trimmed.split(/[.!?]\s/)[0] ?? trimmed;
  const main_character = firstSentence.slice(0, 120);

  const parts = trimmed
    .split(/[.!?]\s|;|,\s(?=then|after|before|next|finally|suddenly)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 4);

  const beats = (parts.length >= 2 ? parts : trimmed.split(/,\s/))
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 6);

  const key_actions = beats.map((b) => `- ${b}`).join("\n");
  return { main_character, key_actions };
}

function buildEnhancedPrompt(
  main_character: string,
  key_actions: string,
  style: string | null,
): string {
  return `Create a short cinematic film with a consistent main character.

Character: ${main_character}

Story beats:
${key_actions}

Style: ${style ?? "cinematic, photoreal"}
Lighting: cinematic, consistent across scenes
Camera: film-style shots (wide, close-up, tracking, over-the-shoulder)

Constraints:
- same character identity in all scenes
- smooth continuity between scenes
- visual clarity and specificity
- no generic descriptions
- every scene description MUST explicitly mention a camera angle (wide / close-up / tracking / over-the-shoulder / etc.) and a lighting/mood word (light, shadow, glow, neon, golden hour, etc.)`;
}

function systemPrompt(scene_count: number): string {
  return `You are a professional film director and storyboard artist.

Convert the given story into EXACTLY ${scene_count} cinematic scenes.

Each scene must include:
- clear character action
- environment details
- camera angle (e.g., wide shot, close-up, tracking)
- lighting and mood
- continuity with previous/next scene

Rules:
- Keep each scene 5–8 seconds
- Maintain the SAME main character across all scenes
- Avoid vague or generic language
- Each description MUST contain at least one camera keyword (wide, close-up, tracking, over-the-shoulder, medium shot, etc.)
- Each description MUST contain at least one lighting/mood keyword (light, shadow, glow, neon, golden hour, dim, harsh, etc.)
- Output STRICT JSON only (no prose, no code fences)

Return format:
[
  {
    "scene_order": 1,
    "description": "Detailed cinematic description...",
    "duration": 6
  }
]`;
}

function tryParseScenes(raw: string): PlannedScene[] | null {
  if (!raw) return null;
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as PlannedScene[]) : null;
  } catch {
    return null;
  }
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function validateScenes(
  scenes: unknown,
  expectedCount: number,
): { ok: true; scenes: PlannedScene[] } | { ok: false; reason: string } {
  if (!Array.isArray(scenes)) return { ok: false, reason: "not an array" };
  if (scenes.length !== expectedCount)
    return { ok: false, reason: `expected ${expectedCount} scenes, got ${scenes.length}` };

  const cleaned: PlannedScene[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i] as Record<string, unknown>;
    const order = Number(s?.scene_order);
    const description = typeof s?.description === "string" ? s.description.trim() : "";
    const duration = Number(s?.duration);

    if (!Number.isInteger(order) || order !== i + 1)
      return { ok: false, reason: `bad scene_order at index ${i}` };
    const wordCount = description.split(/\s+/).filter(Boolean).length;
    if (wordCount < 15)
      return { ok: false, reason: `scene ${order} description too short (${wordCount} words)` };
    if (!Number.isFinite(duration) || duration < 5 || duration > 8)
      return { ok: false, reason: `scene ${order} duration out of range` };
    if (!containsAny(description, CAMERA_KEYWORDS))
      return { ok: false, reason: `scene ${order} missing camera keyword` };
    if (!containsAny(description, LIGHTING_KEYWORDS))
      return { ok: false, reason: `scene ${order} missing lighting keyword` };

    cleaned.push({ scene_order: order, description, duration: Math.round(duration) });
  }
  return { ok: true, scenes: cleaned };
}

async function callGateway(
  apiKey: string,
  system: string,
  user: string,
): Promise<{ status: number; content: string; error?: string }> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return { status: resp.status, content: "", error: errText };
  }
  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  return { status: 200, content };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const project_id = typeof body?.project_id === "string" ? body.project_id : null;
    if (!project_id) return json({ error: "project_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Fetch project
    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, prompt, style, target_duration, user_id, status")
      .eq("id", project_id)
      .maybeSingle();

    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "project not found" }, 404);

    // 2. Project lock — only run from "pending"
    if (project.status !== "pending") {
      return json(
        { error: `project not in pending state (current: ${project.status})`, skipped: true },
        409,
      );
    }

    // 3. Idempotency — skip if scenes already exist
    const { count: existingScenes } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id);

    if ((existingScenes ?? 0) > 0) {
      return json({ success: true, skipped: true, scenes_created: existingScenes });
    }

    // 4. Atomic claim: pending -> planning, progress 20
    const { data: claimed, error: claimErr } = await admin
      .from("projects")
      .update({ status: "planning", progress: 20, error_message: null })
      .eq("id", project_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      return json({ error: "another planScenes run already claimed this project", skipped: true }, 409);
    }

    // 5. Build enhanced prompt + scene count
    const { main_character, key_actions } = deriveCharacterAndActions(project.prompt);
    const enhanced = buildEnhancedPrompt(main_character, key_actions, project.style);
    const scene_count = Math.min(5, sceneCountFor(project.target_duration ?? 60));
    const sys = systemPrompt(scene_count);

    // 6. Call gateway with up to 2 retries (3 attempts total)
    const correctionSuffix =
      "\n\nFix the previous response.\nReturn STRICT JSON only.\nDo not include text outside JSON.\nFollow the exact schema.";

    let parsed: PlannedScene[] | null = null;
    let validation: ReturnType<typeof validateScenes> = { ok: false, reason: "no attempt yet" };
    let lastError: string | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const userMsg = attempt === 0 ? enhanced : enhanced + correctionSuffix +
        (validation.ok ? "" : `\nPrevious error: ${validation.reason}`);

      const result = await callGateway(LOVABLE_API_KEY, sys, userMsg);

      if (result.status === 429) {
        await admin
          .from("projects")
          .update({ status: "pending", error_message: null })
          .eq("id", project_id);
        return json({ error: "Rate limits exceeded, please try again later." }, 429);
      }
      if (result.status === 402) {
        await admin
          .from("projects")
          .update({ status: "pending", error_message: null })
          .eq("id", project_id);
        return json(
          { error: "Payment required, please add funds to your Lovable AI workspace." },
          402,
        );
      }
      if (result.status !== 200) {
        lastError = result.error;
        console.error(`attempt ${attempt + 1} gateway error:`, result.error);
        continue;
      }

      parsed = tryParseScenes(result.content);
      validation = validateScenes(parsed, scene_count);
      if (validation.ok) break;
      console.warn(`attempt ${attempt + 1} invalid: ${validation.reason}`);
    }

    if (!validation.ok) {
      const reason = lastError ?? (validation as { reason: string }).reason;
      await admin
        .from("projects")
        .update({ status: "failed", error_message: `planning failed: ${reason}` })
        .eq("id", project_id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "planning",
        status: "error",
        message: `invalid scenes after 3 attempts: ${reason}`,
      });
      return json({ error: "invalid scenes from model", reason }, 502);
    }

    // 7. Insert scenes
    const rows = validation.scenes.map((s) => ({
      project_id,
      scene_order: s.scene_order,
      description: s.description,
      duration: s.duration,
      status: "pending" as const,
    }));

    const { error: insErr } = await admin.from("scenes").insert(rows);
    if (insErr) {
      await admin
        .from("projects")
        .update({ status: "failed", error_message: insErr.message })
        .eq("id", project_id);
      await admin.from("generation_logs").insert({
        project_id,
        step: "planning",
        status: "error",
        message: `insert failed: ${insErr.message}`,
      });
      return json({ error: insErr.message }, 500);
    }

    // 8. Scenes saved → progress 30, move to generating
    await admin
      .from("projects")
      .update({ status: "generating", progress: 30 })
      .eq("id", project_id);

    await admin.from("generation_logs").insert({
      project_id,
      step: "planning",
      status: "success",
      message: `planned ${scene_count} scenes`,
    });

    return json({ success: true, scenes_created: scene_count });
  } catch (e) {
    console.error("planScenes fatal:", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
