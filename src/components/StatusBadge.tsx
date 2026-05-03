import { Badge } from "@/components/ui/badge";
import { ProjectStatus, STATUS_LABEL } from "@/lib/types";

const COLORS: Record<ProjectStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  planning: "bg-accent/20 text-accent border border-accent/40",
  generating: "bg-primary/20 text-primary border border-primary/40",
  frames_ready: "bg-primary/20 text-primary border border-primary/40",
  clips_ready: "bg-primary/20 text-primary border border-primary/40",
  stitching: "bg-primary/20 text-primary border border-primary/40",
  completed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border border-destructive/30",
};

export const StatusBadge = ({ status }: { status: ProjectStatus }) => (
  <Badge variant="outline" className={`${COLORS[status]} rounded-full px-3 py-0.5 text-xs font-medium`}>
    {STATUS_LABEL[status]}
  </Badge>
);
