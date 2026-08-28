export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      announcement_teams: {
        Row: {
          announcement_id: string;
          id: string;
          team_id: string;
        };
        Insert: {
          announcement_id: string;
          id?: string;
          team_id: string;
        };
        Update: {
          announcement_id?: string;
          id?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcement_teams_announcement_id_fkey";
            columns: ["announcement_id"];
            isOneToOne: false;
            referencedRelation: "announcements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcement_teams_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: {
          audience: string;
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          title: string;
        };
        Insert: {
          audience: string;
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          title: string;
        };
        Update: {
          audience?: string;
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          basecamp_url: string | null;
          contact_email: string | null;
          contact_name: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          subscription_hours: number | null;
        };
        Insert: {
          basecamp_url?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          subscription_hours?: number | null;
        };
        Update: {
          basecamp_url?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          subscription_hours?: number | null;
        };
        Relationships: [];
      };
      member_employment: {
        Row: {
          employment_type: string;
          hourly_rate: number | null;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
          weekly_schedule: string | null;
        };
        Insert: {
          employment_type?: string;
          hourly_rate?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
          weekly_schedule?: string | null;
        };
        Update: {
          employment_type?: string;
          hourly_rate?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
          weekly_schedule?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "member_employment_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_employment_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          is_active: boolean;
          is_pending: boolean;
          job_title: string | null;
          role: Database["public"]["Enums"]["app_role"];
          timezone: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          is_active?: boolean;
          is_pending?: boolean;
          job_title?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          timezone?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          is_pending?: boolean;
          job_title?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          timezone?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tags: {
        Row: {
          id: string;
          project_id: string;
          tag_id: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          tag_id: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tags_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      project_task_categories: {
        Row: {
          id: string;
          project_id: string;
          task_category_id: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          task_category_id: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          task_category_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_task_categories_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_categories_task_category_id_fkey";
            columns: ["task_category_id"];
            isOneToOne: false;
            referencedRelation: "task_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          budget_hours: number | null;
          client_id: string | null;
          color: string;
          created_at: string;
          id: string;
          is_archived: boolean;
          is_billable: boolean;
          name: string;
          team_id: string | null;
        };
        Insert: {
          budget_hours?: number | null;
          client_id?: string | null;
          color?: string;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          is_billable?: boolean;
          name: string;
          team_id?: string | null;
        };
        Update: {
          budget_hours?: number | null;
          client_id?: string | null;
          color?: string;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          is_billable?: boolean;
          name?: string;
          team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      task_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          created_at: string;
          id: string;
          team_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          team_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          team_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      time_entries: {
        Row: {
          created_at: string;
          description: string;
          duration_minutes: number | null;
          end_time: string | null;
          entry_date: string;
          id: string;
          is_billable: boolean;
          project_id: string | null;
          start_time: string;
          tag_ids: string[];
          task: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string;
          duration_minutes?: number | null;
          end_time?: string | null;
          entry_date?: string;
          id?: string;
          is_billable?: boolean;
          project_id?: string | null;
          start_time?: string;
          tag_ids?: string[];
          task?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          duration_minutes?: number | null;
          end_time?: string | null;
          entry_date?: string;
          id?: string;
          is_billable?: boolean;
          project_id?: string | null;
          start_time?: string;
          tag_ids?: string[];
          task?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      timesheets: {
        Row: {
          created_at: string;
          entries_modified_at: string | null;
          id: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["timesheet_status"];
          submitted_at: string | null;
          user_id: string;
          week_start: string;
        };
        Insert: {
          created_at?: string;
          entries_modified_at?: string | null;
          id?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["timesheet_status"];
          submitted_at?: string | null;
          user_id: string;
          week_start: string;
        };
        Update: {
          created_at?: string;
          entries_modified_at?: string | null;
          id?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["timesheet_status"];
          submitted_at?: string | null;
          user_id?: string;
          week_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timesheets_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timesheets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_settings: {
        Row: {
          allow_manual_entry: boolean;
          company_name: string;
          currency: string;
          id: boolean;
          logo_url: string | null;
          require_descriptions: boolean;
          timezone: string;
          updated_at: string;
          weekly_hours: number;
        };
        Insert: {
          allow_manual_entry?: boolean;
          company_name?: string;
          currency?: string;
          id?: boolean;
          logo_url?: string | null;
          require_descriptions?: boolean;
          timezone?: string;
          updated_at?: string;
          weekly_hours?: number;
        };
        Update: {
          allow_manual_entry?: boolean;
          company_name?: string;
          currency?: string;
          id?: boolean;
          logo_url?: string | null;
          require_descriptions?: boolean;
          timezone?: string;
          updated_at?: string;
          weekly_hours?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      announcement_recipients: {
        Args: { _announcement_id: string };
        Returns: {
          author_name: string;
          body: string;
          email: string;
          full_name: string;
          title: string;
        }[];
      };
      approve_member: { Args: { _user_id: string }; Returns: undefined };
      can_manage: { Args: { _user_id: string }; Returns: boolean };
      create_announcement: {
        Args: {
          _audience: string;
          _body: string;
          _team_ids: string[];
          _title: string;
        };
        Returns: string;
      };
      delete_tag: { Args: { _tag_id: string }; Returns: undefined };
      description_required: { Args: never; Returns: boolean };
      employee_billable_hours_range: {
        Args: { _from: string; _to: string };
        Returns: {
          minutes: number;
          user_id: string;
        }[];
      };
      employee_client_hours_range: {
        Args: { _from: string; _to: string };
        Returns: {
          client_id: string;
          minutes: number;
          user_id: string;
        }[];
      };
      employee_hours_range: {
        Args: { _from: string; _to: string };
        Returns: {
          minutes: number;
          user_id: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      hook_restrict_signup_to_invited: { Args: { event: Json }; Returns: Json };
      is_active_user: { Args: { _user_id: string }; Returns: boolean };
      is_approved: { Args: { _user_id: string }; Returns: boolean };
      manual_entry_allowed: { Args: never; Returns: boolean };
      project_billable_hours_range: {
        Args: { _from: string; _to: string };
        Returns: {
          billable_minutes: number;
          project_id: string;
        }[];
      };
      project_hours: {
        Args: never;
        Returns: {
          project_id: string;
          total_minutes: number;
          week_minutes: number;
        }[];
      };
      project_hours_range: {
        Args: { _from: string; _to: string };
        Returns: {
          minutes: number;
          project_id: string;
        }[];
      };
      review_timesheet: {
        Args: {
          _note?: string;
          _status: Database["public"]["Enums"]["timesheet_status"];
          _timesheet_id: string;
        };
        Returns: {
          created_at: string;
          entries_modified_at: string | null;
          id: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["timesheet_status"];
          submitted_at: string | null;
          user_id: string;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "timesheets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_member_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      shares_team: { Args: { _a: string; _b: string }; Returns: boolean };
      stop_timer: {
        Args: { _description: string; _entry_id: string; _segments: Json };
        Returns: undefined;
      };
      submit_timesheet: {
        Args: { _week_start: string };
        Returns: {
          created_at: string;
          entries_modified_at: string | null;
          id: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["timesheet_status"];
          submitted_at: string | null;
          user_id: string;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "timesheets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      tag_usage: {
        Args: never;
        Returns: {
          entry_count: number;
          tag_id: string;
        }[];
      };
      timesheet_submission_recipients: {
        Args: { _timesheet_id: string };
        Returns: {
          email: string;
          full_name: string;
          submitter_name: string;
          week_start: string;
        }[];
      };
      week_is_locked: {
        Args: { _entry_date: string; _user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "manager" | "member";
      timesheet_status: "draft" | "submitted" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "manager", "member"],
      timesheet_status: ["draft", "submitted", "approved", "rejected"],
    },
  },
} as const;
