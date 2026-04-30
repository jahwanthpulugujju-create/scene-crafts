import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Film } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import type { Project } from "@/lib/types";

const Dashboard = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setProjects((data as Project[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    setProjects((p) => p.filter((x) => x.id !== id));
  };

  return (
    <div className="min-h-screen bg-hero">
      <Navbar />
      <main className="container py-12">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Your projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every video you've started, in one place.
            </p>
          </div>
          <Button asChild className="bg-gradient-primary text-primary-foreground hover:opacity-90">
            <Link to="/projects/new">
              <Plus className="mr-2 h-4 w-4" /> New project
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-border/60 bg-card/40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-16 text-center">
            <Film className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">No projects yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a character image and write a prompt to begin.
            </p>
            <Button asChild className="mt-6 bg-gradient-primary text-primary-foreground hover:opacity-90">
              <Link to="/projects/new">Create your first project</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-card shadow-soft transition hover:border-primary/40">
                <Link to={`/projects/${p.id}`} className="block">
                  <div className="aspect-video overflow-hidden bg-muted">
                    {p.character_image_url ? (
                      <img src={p.character_image_url} alt={p.title} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <Film className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate font-medium">{p.title}</h3>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{p.prompt}</p>
                  </div>
                </Link>
                <button
                  onClick={() => remove(p.id)}
                  className="absolute right-3 top-3 rounded-full bg-background/80 p-2 opacity-0 backdrop-blur transition hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
