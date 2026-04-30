import { Link } from "react-router-dom";
import { ArrowRight, Film, Sparkles, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";

const Landing = () => {
  const { user } = useAuth();
  const cta = user ? "/dashboard" : "/auth";

  return (
    <div className="min-h-screen bg-hero">
      <Navbar />

      <section className="container py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI character video, scene by scene
          </div>
          <h1 className="text-balance text-5xl font-bold tracking-tight md:text-7xl">
            Turn one photo into a{" "}
            <span className="text-gradient">cinematic short</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Upload a character. Describe the story. We plan the scenes, keep your
            character consistent across every shot, and stitch it into a single video.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
              <Link to={cta}>
                Start creating <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href="#how">How it works</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="how" className="container pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Users, title: "Same character everywhere", desc: "Your reference image is locked in across every scene." },
            { icon: Film, title: "Scene-by-scene planning", desc: "Prompts are split into 3–5 short shots, then generated and stitched." },
            { icon: Zap, title: "Async pipeline", desc: "Plan, generate, and stitch run in the background. Watch progress live." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-1 font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Landing;
