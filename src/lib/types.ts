export type ProjectStatus =
  | "pending"
  | "planning"
  | "generating"
  | "frames_ready"
  | "clips_ready"
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

export interface GenerationLog {
  id: string;
  project_id: string;
  step: string;
  status: string;
  message: string | null;
  created_at: string;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  pending: "Pending",
  planning: "Planning scenes",
  generating: "Generating scenes",
  frames_ready: "Frames ready",
  clips_ready: "Clips ready",
  stitching: "Stitching video",
  completed: "Completed",
  failed: "Failed",
};

export const STAGE_LABEL: Record<ProjectStatus, string> = {
  pending: "Idle",
  planning: "Planning scenes",
  generating: "Generating scenes",
  frames_ready: "Generating scenes",
  clips_ready: "Building clips",
  stitching: "Stitching final video",
  completed: "Done",
  failed: "Failed",
};
