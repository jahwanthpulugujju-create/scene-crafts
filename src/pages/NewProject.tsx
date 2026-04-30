import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { toast } from "sonner";
import { Upload, Image as ImageIcon, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const schema = z.object({
  title: z.string().trim().min(2, "Title is too short").max(120),
  prompt: z.string().trim().min(10, "Describe your scene a bit more").max(2000),
  style: z.string().max(40).optional(),
  target_duration: z.number().int().min(15).max(120),
});

const STYLES = ["Cinematic", "Realistic", "Anime", "Vlog", "Noir"];

const NewProject = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("Cinematic");
  const [duration, setDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!ALLOWED.includes(f.type)) return toast.error("Use a JPG, PNG, or WEBP image");
    if (f.size > MAX_BYTES) return toast.error("Image must be under 8MB");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!file) return toast.error("Please upload a character image");
    const parsed = schema.safeParse({ title, prompt, style, target_duration: duration });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);

    setSubmitting(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          title,
          prompt,
          style,
          target_duration: duration,
          character_image_url: pub.publicUrl,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from("assets").insert({
        project_id: project.id,
        type: "image",
        path,
        url: pub.publicUrl,
      });

      toast.success("Project created");
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      toast.error(err.message ?? "Could not create project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-hero">
      <Navbar />
      <main className="container py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">New project</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your character and describe the story.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-6 rounded-2xl border border-border/60 bg-gradient-card p-8 shadow-soft">
            <div>
              <Label className="mb-2 block">Character reference</Label>
              <label
                htmlFor="image"
                className="relative flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-background/40 transition hover:border-primary/60"
              >
                {preview ? (
                  <img src={preview} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">Click to upload</p>
                    <p className="text-xs text-muted-foreground">JPG, PNG, WEBP · up to 8MB</p>
                  </div>
                )}
                <input
                  id="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="My short film" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                rows={5}
                placeholder="A young explorer walks through a misty forest, then discovers a glowing artifact at the edge of a cliff."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">{prompt.length}/2000</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Style</Label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Target duration (seconds)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={15}
                  max={120}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
              <Sparkles className="mr-2 h-4 w-4" />
              {submitting ? "Creating…" : "Create project"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default NewProject;
