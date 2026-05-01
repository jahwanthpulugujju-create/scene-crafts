export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          path: string
          project_id: string
          type: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          path: string
          project_id: string
          type: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          path?: string
          project_id?: string
          type?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_logs: {
        Row: {
          created_at: string
          id: string
          message: string | null
          project_id: string
          status: string
          step: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          project_id: string
          status: string
          step: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          project_id?: string
          status?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          character_image_url: string | null
          created_at: string
          error_message: string | null
          final_video_url: string | null
          id: string
          progress: number
          prompt: string
          status: Database["public"]["Enums"]["project_status"]
          style: string | null
          target_duration: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_image_url?: string | null
          created_at?: string
          error_message?: string | null
          final_video_url?: string | null
          id?: string
          progress?: number
          prompt: string
          status?: Database["public"]["Enums"]["project_status"]
          style?: string | null
          target_duration?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_image_url?: string | null
          created_at?: string
          error_message?: string | null
          final_video_url?: string | null
          id?: string
          progress?: number
          prompt?: string
          status?: Database["public"]["Enums"]["project_status"]
          style?: string | null
          target_duration?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scenes: {
        Row: {
          action: string | null
          camera: string | null
          created_at: string
          description: string
          duration: number
          environment: string | null
          error_message: string | null
          id: string
          mood: string | null
          project_id: string
          scene_order: number
          status: Database["public"]["Enums"]["scene_status"]
          updated_at: string
          video_url: string | null
        }
        Insert: {
          action?: string | null
          camera?: string | null
          created_at?: string
          description: string
          duration?: number
          environment?: string | null
          error_message?: string | null
          id?: string
          mood?: string | null
          project_id: string
          scene_order: number
          status?: Database["public"]["Enums"]["scene_status"]
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          action?: string | null
          camera?: string | null
          created_at?: string
          description?: string
          duration?: number
          environment?: string | null
          error_message?: string | null
          id?: string
          mood?: string | null
          project_id?: string
          scene_order?: number
          status?: Database["public"]["Enums"]["scene_status"]
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_owns_project: { Args: { _project_id: string }; Returns: boolean }
    }
    Enums: {
      project_status:
        | "pending"
        | "planning"
        | "generating"
        | "stitching"
        | "completed"
        | "failed"
        | "frames_ready"
        | "clips_ready"
      scene_status: "pending" | "generating" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      project_status: [
        "pending",
        "planning",
        "generating",
        "stitching",
        "completed",
        "failed",
        "frames_ready",
        "clips_ready",
      ],
      scene_status: ["pending", "generating", "completed", "failed"],
    },
  },
} as const
