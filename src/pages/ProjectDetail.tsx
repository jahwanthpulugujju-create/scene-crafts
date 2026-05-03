import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";
import { STAGE_LABEL, type GenerationLog, type Project, type Scene } from "@/lib/types";

const ACTIVE_STATUSES: Project["status"][] = [
  "pending",
  "planning",
  "generating",
  "frames_ready",
  "clips_ready",
  "stitching",
];

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  // Initial load + realtime + polling fallback
  useEffect(() => {
    if (!id) return;
    let active = true;

    const loadAll = async () => {
      const [{ data: p }, { data: s }, { data: l }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).maybeSingle(),
        supabase.from("scenes").select("*").eq("project_id", id).order("scene_order"),
        supabase
          .from("generation_logs")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (!active) return;
      setProject((p as Project) ?? null);
      setScenes((s as Scene[]) ?? []);
      setLogs((l as GenerationLog[]) ?? []);
      setLoading(false);
    };
    loadAll();

    const channel = supabase
      .channel(`project-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` },
        (payload) => setProject(payload.new as Project),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenes", filter: `project_id=eq.${id}` },
        () =>
          supabase
            .from("scenes")
            .select("*")
            .eq("project_id", id)
            .order("scene_order")
            .then(({ data }) => setScenes((data as Scene[]) ?? [])),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "generation_logs", filter: `project_id=eq.${id}` },
        (payload) => setLogs((prev) => [payload.new as GenerationLog, ...prev].slice(0, 50)),
      )
      .subscribe();

    // Polling fallback every 3s while project is in an active state
    const poll = setInterval(() => {
      if (!active) return;
      const status = (project?.status ?? "pending") as Project["status"];
      if (ACTIVE_STATUSES.includes(status) || runningRef.current) {
        loadAll();
      }
    }, 3000);

    return () => {
      active = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const failedScenes = useMemo(() => scenes.filter((s) => s.status === "failed"), [scenes]);

  const runStep = async (fn: string) => {
    const { data, error } = await supabase.functions.invoke(fn, { body: { project_id: id } });
    if (error) throw new Error(error.message);
    if ((data as any)?.error && !(data as any)?.skipped) throw new Error((data as any).error);
    return data;
  };

  const startGeneration = async () => {
    if (!id || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      if (!project || project.status === "pending" || scenes.length === 0) {
        toast.info("Planning scenes…");
        await runStep("planScenes");
      }
      if (!project || project.status !== "completed") {
        toast.info("Generating frames…");
        await runStep("generateSceneFrames");
        toast.info("Building scene clips…");
        await runStep("buildSceneVideos");
        toast.info("Stitching final video…");
        await runStep("stitchProjectVideo");
      }
      toast.success("Generation complete!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const retryFailedScenes = async () => {
    if (!id || failedScenes.length === 0 || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      // Reset only failed scenes back to pending so generateSceneFrames will pick them up
      const ids = failedScenes.map((s) => s.id);
      await supabase
        .from("scenes")
        .update({ status: "pending", error_message: null, video_url: null })
        .in("id", ids);
      // Make sure project is in a state the function accepts
      await supabase
        .from("projects")
        .update({ status: "generating", error_message: null })
        .eq("id", id);

      toast.info(`Retrying ${ids.length} failed scene${ids.length > 1 ? "s" : ""}…`);
      await runStep("generateSceneFrames");
      await runStep("buildSceneVideos");
      await runStep("stitchProjectVideo");
      toast.success("Retry complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const resetProject = async () => {
    if (!id) return;
    if (!confirm("Reset project? This deletes scenes & frames so generation starts over.")) return;
    await supabase.from("assets").delete().eq("project_id", id);
    await supabase.from("scenes").delete().eq("project_id", id);
    await supabase
      .from("projects")
      .update({ status: "pending", progress: 0, error_message: null, final_video_url: null })
      .eq("id", id);
    toast.success("Project reset");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-hero">
        <Navbar />
        <div className="container py-20 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-hero">
        <Navbar />
        <div className="container py-20 text-center">
          <p className="text-muted-foreground">Project not found</p>
          <Button asChild variant="ghost" className="mt-4">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isActive = ACTIVE_STATUSES.includes(project.status) && project.status !== "pending";
  const errorCount = logs.filter((l) => l.status === "error").length;

  return (
    <div className="min-h-screen bg-hero">
      <Navbar />
      <main className="container py-10">
        <Button asChild variant="ghost" size="sm" className="mb-6">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
          </Link>
        </Button>

        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
                <StatusBadge status={project.status} />
              </div>
              <p className="mt-3 text-muted-foreground">{project.prompt}</p>
            </div>

            {/* Progress + stage */}
            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Stage:</span>
                  <span className="text-sm text-muted-foreground">{STAGE_LABEL[project.status]}</span>
                  {isActive && (
                    <RefreshCw className="ml-1 h-3 w-3 animate-spin text-primary" />
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{project.progress}%</span>
              </div>
              <Progress value={project.progress} />
              {project.error_message && (
                <p className="mt-3 text-sm text-destructive">{project.error_message}</p>
              )}
            </div>

            {/* Final video */}
            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <h2 className="mb-4 font-medium">Final video</h2>
              {project.final_video_url ? (
                <>
                  <video
                    src={project.final_video_url}
                    controls
                    className="w-full rounded-xl bg-black"
                  />
                  <Button
                    asChild
                    className="mt-4 bg-gradient-primary text-primary-foreground hover:opacity-90"
                  >
                    <a href={project.final_video_url} download>
                      <Download className="mr-2 h-4 w-4" /> Download
                    </a>
                  </Button>
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border bg-background/40 text-muted-foreground">
                  <div className="text-center">
                    <Play className="mx-auto h-8 w-8" />
                    <p className="mt-2 text-sm">Final video will appear here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Scenes */}
            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Scenes</h2>
                {failedScenes.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={retryFailedScenes}
                  >
                    <RefreshCw className="mr-2 h-3 w-3" />
                    Retry {failedScenes.length} failed
                  </Button>
                )}
              </div>
              {scenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No scenes planned yet. They'll appear after planning.
                </p>
              ) : (
                <ol className="space-y-3">
                  {scenes.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-xl border border-border/60 bg-background/40 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Scene {s.scene_order}</span>
                        <StatusBadge status={s.status as any} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                      {s.error_message && (
                        <p className="mt-2 text-xs text-destructive">{s.error_message}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Generation logs */}
            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Generation logs</h2>
                <span className="text-xs text-muted-foreground">
                  {logs.length} entries · {errorCount} errors
                </span>
              </div>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No log entries yet.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-auto pr-1">
                  {logs.map((log) => (
                    <li
                      key={log.id}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        log.status === "error"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-border/60 bg-background/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {log.step} · {log.status}
                        </span>
                        <span className="opacity-70">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      {log.message && (
                        <p className="mt-1 break-words font-mono text-[11px] leading-snug">
                          {log.message}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Aside */}
          <aside className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-card shadow-soft">
              <div className="aspect-square bg-muted">
                {project.character_image_url && (
                  <img
                    src={project.character_image_url}
                    alt="Character"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Character reference
                </p>
                <p className="mt-1 text-sm">
                  Used across every scene to keep identity consistent.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <h3 className="font-medium">Details</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Style</dt>
                  <dd>{project.style ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd>{project.target_duration}s</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Scenes</dt>
                  <dd>{scenes.length}</dd>
                </div>
              </dl>

              {project.status !== "completed" && (
                <Button
                  onClick={startGeneration}
                  disabled={running}
                  className="mt-5 w-full bg-gradient-primary text-primary-foreground hover:opacity-90"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {running
                    ? "Working…"
                    : project.status === "pending"
                      ? "Start generation"
                      : "Resume / Retry"}
                </Button>
              )}
              {project.status !== "pending" && !running && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-muted-foreground hover:text-destructive"
                  onClick={resetProject}
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  Reset project
                </Button>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default ProjectDetail;
