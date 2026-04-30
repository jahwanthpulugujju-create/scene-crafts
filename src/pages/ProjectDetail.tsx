import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";
import type { Project, Scene } from "@/lib/types";

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async () => {
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).maybeSingle(),
        supabase.from("scenes").select("*").eq("project_id", id).order("scene_order"),
      ]);
      if (!active) return;
      setProject((p as Project) ?? null);
      setScenes((s as Scene[]) ?? []);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`project-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` },
        (payload) => setProject(payload.new as Project))
      .on("postgres_changes", { event: "*", schema: "public", table: "scenes", filter: `project_id=eq.${id}` },
        () => supabase.from("scenes").select("*").eq("project_id", id).order("scene_order")
          .then(({ data }) => setScenes((data as Scene[]) ?? [])))
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [id]);

  const startGeneration = async () => {
    toast.info("Generation pipeline will be wired up in the next phase");
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
          <Button asChild variant="ghost" className="mt-4"><Link to="/dashboard">Back to dashboard</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hero">
      <Navbar />
      <main className="container py-10">
        <Button asChild variant="ghost" size="sm" className="mb-6">
          <Link to="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Dashboard</Link>
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

            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Progress</span>
                <span className="text-sm text-muted-foreground">{project.progress}%</span>
              </div>
              <Progress value={project.progress} />
              {project.error_message && (
                <p className="mt-3 text-sm text-destructive">{project.error_message}</p>
              )}
            </div>

            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <h2 className="mb-4 font-medium">Final video</h2>
              {project.final_video_url ? (
                <>
                  <video src={project.final_video_url} controls className="w-full rounded-xl bg-black" />
                  <Button asChild className="mt-4 bg-gradient-primary text-primary-foreground hover:opacity-90">
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

            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <h2 className="mb-4 font-medium">Scenes</h2>
              {scenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scenes planned yet. They'll appear after planning.</p>
              ) : (
                <ol className="space-y-3">
                  {scenes.map((s) => (
                    <li key={s.id} className="rounded-xl border border-border/60 bg-background/40 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Scene {s.scene_order}</span>
                        <StatusBadge status={s.status as any} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-card shadow-soft">
              <div className="aspect-square bg-muted">
                {project.character_image_url && (
                  <img src={project.character_image_url} alt="Character" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Character reference</p>
                <p className="mt-1 text-sm">Used across every scene to keep identity consistent.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <h3 className="font-medium">Details</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Style</dt><dd>{project.style ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Duration</dt><dd>{project.target_duration}s</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Scenes</dt><dd>{scenes.length}</dd></div>
              </dl>

              {project.status === "pending" && (
                <Button onClick={startGeneration} className="mt-5 w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
                  <Sparkles className="mr-2 h-4 w-4" /> Start generation
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
