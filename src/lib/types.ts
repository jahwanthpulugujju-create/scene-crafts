export type ProjectStatus =
  | "pending"
  | "planning"
  | "generating"
  | "stitching"
  | "completed"
  | "failed";

export type SceneStatus = "pending" | "generating" | "completed" | "failed";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  style: string | null;
  target_duration: number;
  status: ProjectStatus;
  progress: number;
  character_image_url: string | null;
  final_video_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  scene_order: number;
  description: string;
  action: string | null;
  environment: string | null;
  camera: string | null;
  mood: string | null;
  duration: number;
  status: SceneStatus;
  video_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  pending: "Pending",
  planning: "Planning scenes",
  generating: "Generating clips",
  stitching: "Stitching video",
  completed: "Completed",
  failed: "Failed",
};
