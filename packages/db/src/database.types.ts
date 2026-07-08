export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_providers: {
        Row: {
          api_key_encrypted: string | null
          available_models: string[]
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          provider_key: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          available_models?: string[]
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          provider_key: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          available_models?: string[]
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          provider_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      assistant_attachments: {
        Row: {
          chat_id: string
          created_at: string
          extracted_text: string | null
          file_name: string
          id: string
          r2_key: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          extracted_text?: string | null
          file_name: string
          id?: string
          r2_key?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          id?: string
          r2_key?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_attachments_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "assistant_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_attachments_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_chats: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          model: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          model?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          model?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_chats_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          attachment_ids: string[]
          chat_id: string
          content: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["assistant_msg_role"]
          token_usage: Json | null
        }
        Insert: {
          attachment_ids?: string[]
          chat_id: string
          content: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["assistant_msg_role"]
          token_usage?: Json | null
        }
        Update: {
          attachment_ids?: string[]
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["assistant_msg_role"]
          token_usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "assistant_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      client_aliases: {
        Row: {
          alias: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          alias: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          alias?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_aliases_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_domains: {
        Row: {
          client_id: string
          created_at: string
          domain: string
          id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          domain: string
          id?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          domain?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_domains_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_health_history: {
        Row: {
          breakdown: Json | null
          client_id: string
          computed_at: string
          id: string
          score: number
        }
        Insert: {
          breakdown?: Json | null
          client_id: string
          computed_at?: string
          id?: string
          score: number
        }
        Update: {
          breakdown?: Json | null
          client_id?: string
          computed_at?: string
          id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_health_history_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          author_user_id: string | null
          client_id: string
          content: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          client_id: string
          content: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          client_id?: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tabs: {
        Row: {
          client_id: string | null
          created_by_user_id: string | null
          id: string
          tab_order: Json
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_by_user_id?: string | null
          id?: string
          tab_order: Json
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_by_user_id?: string | null
          id?: string
          tab_order?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tabs_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tabs_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_cadence: string | null
          cadence: Database["public"]["Enums"]["client_cadence"]
          contract_number: string | null
          contract_value: number | null
          created_at: string
          description: string | null
          drive_folder_url: string | null
          fee_tier: Database["public"]["Enums"]["fee_tier"] | null
          health_adjustments: Json | null
          health_updated_at: string | null
          id: string
          initials: string
          last_meeting_at: string | null
          name: string
          primary_contact: string | null
          primary_contact_email: string | null
          relationship_health: number | null
          relationship_trend:
            | Database["public"]["Enums"]["relationship_trend"]
            | null
          type: Database["public"]["Enums"]["client_type"]
          updated_at: string
        }
        Insert: {
          billing_cadence?: string | null
          cadence?: Database["public"]["Enums"]["client_cadence"]
          contract_number?: string | null
          contract_value?: number | null
          created_at?: string
          description?: string | null
          drive_folder_url?: string | null
          fee_tier?: Database["public"]["Enums"]["fee_tier"] | null
          health_adjustments?: Json | null
          health_updated_at?: string | null
          id?: string
          initials: string
          last_meeting_at?: string | null
          name: string
          primary_contact?: string | null
          primary_contact_email?: string | null
          relationship_health?: number | null
          relationship_trend?:
            | Database["public"]["Enums"]["relationship_trend"]
            | null
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Update: {
          billing_cadence?: string | null
          cadence?: Database["public"]["Enums"]["client_cadence"]
          contract_number?: string | null
          contract_value?: number | null
          created_at?: string
          description?: string | null
          drive_folder_url?: string | null
          fee_tier?: Database["public"]["Enums"]["fee_tier"] | null
          health_adjustments?: Json | null
          health_updated_at?: string | null
          id?: string
          initials?: string
          last_meeting_at?: string | null
          name?: string
          primary_contact?: string | null
          primary_contact_email?: string | null
          relationship_health?: number | null
          relationship_trend?:
            | Database["public"]["Enums"]["relationship_trend"]
            | null
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Relationships: []
      }
      daily_syncs: {
        Row: {
          content: Json
          created_at: string
          delivered_at: string | null
          generated_at: string | null
          id: string
          meeting_ids_included: string[]
          sync_date: string
        }
        Insert: {
          content: Json
          created_at?: string
          delivered_at?: string | null
          generated_at?: string | null
          id?: string
          meeting_ids_included?: string[]
          sync_date: string
        }
        Update: {
          content?: Json
          created_at?: string
          delivered_at?: string | null
          generated_at?: string | null
          id?: string
          meeting_ids_included?: string[]
          sync_date?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          client_id: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_size: number | null
          folder_id: string | null
          id: string
          meeting_id: string | null
          r2_key: string
          requires_review: boolean
          source_badge: Database["public"]["Enums"]["document_source"]
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string
          uploaded_by_user_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_size?: number | null
          folder_id?: string | null
          id?: string
          meeting_id?: string | null
          r2_key: string
          requires_review?: boolean
          source_badge: Database["public"]["Enums"]["document_source"]
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          file_size?: number | null
          folder_id?: string | null
          id?: string
          meeting_id?: string | null
          r2_key?: string
          requires_review?: boolean
          source_badge?: Database["public"]["Enums"]["document_source"]
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_meeting_id_fkey"
            columns: ["meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          chunk_index: number
          client_id: string | null
          content: string
          created_at: string
          embedding: string
          id: string
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }
        Insert: {
          chunk_index: number
          client_id?: string | null
          content: string
          created_at?: string
          embedding: string
          id?: string
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }
        Update: {
          chunk_index?: number
          client_id?: string | null
          content?: string
          created_at?: string
          embedding?: string
          id?: string
          source_id?: string
          source_type?: Database["public"]["Enums"]["embedding_source"]
        }
        Relationships: [
          {
            foreignKeyName: "embeddings_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["user_role"][]
          client_id: string | null
          created_at: string
          created_by_user_id: string | null
          display_name: string
          id: string
          path: string
          visibility: Database["public"]["Enums"]["folder_visibility"]
        }
        Insert: {
          allowed_roles?: Database["public"]["Enums"]["user_role"][]
          client_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          display_name: string
          id?: string
          path: string
          visibility?: Database["public"]["Enums"]["folder_visibility"]
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["user_role"][]
          client_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          display_name?: string
          id?: string
          path?: string
          visibility?: Database["public"]["Enums"]["folder_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "folders_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_set: boolean
          label: string
          last_test_ok: boolean | null
          last_tested_at: string | null
          secret_encrypted: string | null
          service: Database["public"]["Enums"]["integration_key"]
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_set?: boolean
          label: string
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          secret_encrypted?: string | null
          service: Database["public"]["Enums"]["integration_key"]
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_set?: boolean
          label?: string
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          secret_encrypted?: string | null
          service?: Database["public"]["Enums"]["integration_key"]
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_documents: {
        Row: {
          ai_active: boolean
          created_at: string
          description: string | null
          expiration_date: string | null
          file_name: string
          file_size: number | null
          id: string
          r2_key: string
          title: string
          topic_tags: string[]
          uploaded_by_user_id: string | null
        }
        Insert: {
          ai_active?: boolean
          created_at?: string
          description?: string | null
          expiration_date?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          r2_key: string
          title: string
          topic_tags?: string[]
          uploaded_by_user_id?: string | null
        }
        Update: {
          ai_active?: boolean
          created_at?: string
          description?: string | null
          expiration_date?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          r2_key?: string
          title?: string
          topic_tags?: string[]
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_documents_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      master_record_entries: {
        Row: {
          client_id: string
          created_at: string
          id: string
          meeting_id: string | null
          summary: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          meeting_id?: string | null
          summary: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          meeting_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_record_entries_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_record_entries_meeting_id_fkey"
            columns: ["meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_type_rules: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          keyword: string
          meeting_type: Database["public"]["Enums"]["meeting_type"]
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          keyword: string
          meeting_type: Database["public"]["Enums"]["meeting_type"]
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          keyword?: string
          meeting_type?: Database["public"]["Enums"]["meeting_type"]
        }
        Relationships: [
          {
            foreignKeyName: "meeting_type_rules_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_clients: {
        Row: {
          client_id: string
          created_at: string
          meeting_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          meeting_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          meeting_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_clients_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_clients_meeting_id_fkey"
            columns: ["meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          attendee_user_ids: string[]
          bot_dispatched: boolean
          bot_job_id: string | null
          calendar_event_id: string | null
          client_id: string | null
          created_at: string
          date_time: string
          duration_minutes: number | null
          external_attendees: Json
          has_open_items: boolean
          id: string
          is_internal: boolean
          meeting_lead_user_id: string | null
          meeting_type: Database["public"]["Enums"]["meeting_type"] | null
          pipeline_completed_at: string | null
          pipeline_started_at: string | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          source: Database["public"]["Enums"]["meeting_source"]
          title: string | null
          transcript_received: boolean
          updated_at: string
          video_link: string | null
        }
        Insert: {
          attendee_user_ids?: string[]
          bot_dispatched?: boolean
          bot_job_id?: string | null
          calendar_event_id?: string | null
          client_id?: string | null
          created_at?: string
          date_time: string
          duration_minutes?: number | null
          external_attendees?: Json
          has_open_items?: boolean
          id?: string
          is_internal?: boolean
          meeting_lead_user_id?: string | null
          meeting_type?: Database["public"]["Enums"]["meeting_type"] | null
          pipeline_completed_at?: string | null
          pipeline_started_at?: string | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          source?: Database["public"]["Enums"]["meeting_source"]
          title?: string | null
          transcript_received?: boolean
          updated_at?: string
          video_link?: string | null
        }
        Update: {
          attendee_user_ids?: string[]
          bot_dispatched?: boolean
          bot_job_id?: string | null
          calendar_event_id?: string | null
          client_id?: string | null
          created_at?: string
          date_time?: string
          duration_minutes?: number | null
          external_attendees?: Json
          has_open_items?: boolean
          id?: string
          is_internal?: boolean
          meeting_lead_user_id?: string | null
          meeting_type?: Database["public"]["Enums"]["meeting_type"] | null
          pipeline_completed_at?: string | null
          pipeline_started_at?: string | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          source?: Database["public"]["Enums"]["meeting_source"]
          title?: string | null
          transcript_received?: boolean
          updated_at?: string
          video_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_meeting_lead_user_id_fkey"
            columns: ["meeting_lead_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          documents_generated: number
          duration_seconds: number | null
          error_message: string | null
          id: string
          meeting_id: string | null
          source: Database["public"]["Enums"]["pipeline_run_source"]
          started_at: string
          status: Database["public"]["Enums"]["pipeline_run_status"] | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          documents_generated?: number
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          meeting_id?: string | null
          source: Database["public"]["Enums"]["pipeline_run_source"]
          started_at?: string
          status?: Database["public"]["Enums"]["pipeline_run_status"] | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          documents_generated?: number
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          meeting_id?: string | null
          source?: Database["public"]["Enums"]["pipeline_run_source"]
          started_at?: string
          status?: Database["public"]["Enums"]["pipeline_run_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_meeting_id_fkey"
            columns: ["meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_meeting_briefs: {
        Row: {
          content: string
          created_at: string
          delivered_at: string | null
          delivered_to_user_ids: string[]
          generated_at: string | null
          id: string
          meeting_id: string
          r2_key: string | null
        }
        Insert: {
          content: string
          created_at?: string
          delivered_at?: string | null
          delivered_to_user_ids?: string[]
          generated_at?: string | null
          id?: string
          meeting_id: string
          r2_key?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          delivered_at?: string | null
          delivered_to_user_ids?: string[]
          generated_at?: string | null
          id?: string
          meeting_id?: string
          r2_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_meeting_briefs_meeting_id_fkey"
            columns: ["meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by_user_id: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by_user_id?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by_user_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notes: {
        Row: {
          author_user_id: string | null
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_user_id?: string | null
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_user_id?: string | null
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_notes_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived: boolean
          client_id: string
          created_at: string
          description: string
          due_date: string | null
          id: string
          owner_user_id: string | null
          priority_flag: boolean
          source_document_id: string | null
          source_meeting_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
        }
        Insert: {
          archived?: boolean
          client_id: string
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          owner_user_id?: string | null
          priority_flag?: boolean
          source_document_id?: string | null
          source_meeting_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Update: {
          archived?: boolean
          client_id?: string
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          owner_user_id?: string | null
          priority_flag?: boolean
          source_document_id?: string | null
          source_meeting_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_user_id_fkey"
            columns: ["owner_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_document_id_fkey"
            columns: ["source_document_id"]
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_meeting_id_fkey"
            columns: ["source_meeting_id"]
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auto_join_meetings: boolean
          calendar_connected: boolean
          created_at: string
          deactivated_at: string | null
          email: string
          id: string
          initials: string
          last_active_at: string | null
          logto_id: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          auto_join_meetings?: boolean
          calendar_connected?: boolean
          created_at?: string
          deactivated_at?: string | null
          email: string
          id?: string
          initials: string
          last_active_at?: string | null
          logto_id: string
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          auto_join_meetings?: boolean
          calendar_connected?: boolean
          created_at?: string
          deactivated_at?: string | null
          email?: string
          id?: string
          initials?: string
          last_active_at?: string | null
          logto_id?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      auth_uid: { Args: never; Returns: string }
      match_all_embeddings: {
        Args: {
          match_count?: number
          query_embedding: string
        }
        Returns: {
          client_id: string | null
          content: string
          id: string
          similarity: number
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }[]
      }
      match_embeddings: {
        Args: {
          match_client_id: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }[]
      }
      match_kb_embeddings: {
        Args: {
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_id: string
        }[]
      }
    }
    Enums: {
      assistant_msg_role: "user" | "assistant"
      client_cadence: "weekly" | "biweekly" | "monthly" | "qbr" | "ad_hoc"
      client_type: "client" | "prospect" | "lead" | "partner" | "internal"
      document_source: "meeting" | "upload" | "auto"
      document_status: "ready" | "needs_review" | "delivered" | "archived"
      document_type:
        | "post_meeting_analysis"
        | "internal_memo"
        | "client_summary"
        | "task_checklist"
        | "internal_email_draft"
        | "client_email_draft"
        | "pre_meeting_brief"
        | "daily_sync"
        | "upload"
        | "other"
      embedding_source:
        | "meeting_document"
        | "upload"
        | "knowledge_base"
        | "transcript"
      fee_tier: "low" | "mid" | "high"
      folder_visibility: "all" | "restricted"
      integration_key:
        | "recall"
        | "openai"
        | "anthropic"
        | "resend"
        | "r2"
        | "ms_graph"
        | "logto"
        | "supabase"
      meeting_source: "calendar" | "manual"
      meeting_type:
        | "weekly_sync"
        | "biweekly_cadence"
        | "monthly_review"
        | "qbr"
        | "technical_review"
        | "kickoff"
        | "ad_hoc"
      notification_type:
        | "documents_ready"
        | "needs_attention"
        | "task_assigned"
        | "kb_expiring"
        | "calendar_disconnect"
        | "pipeline_failed"
      pipeline_run_source: "recall" | "manual_upload"
      pipeline_run_status: "success" | "failed" | "partial"
      pipeline_status:
        | "scheduled"
        | "in_progress"
        | "awaiting_transcript"
        | "processing"
        | "complete"
        | "needs_attention"
        | "cancelled"
      relationship_trend: "improving" | "stable" | "declining"
      task_status: "open" | "in_progress" | "complete"
      user_role: "admin" | "standard" | "viewer"
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
      assistant_msg_role: ["user", "assistant"],
      client_cadence: ["weekly", "biweekly", "monthly", "qbr", "ad_hoc"],
      client_type: ["client", "prospect", "lead", "partner", "internal"],
      document_source: ["meeting", "upload", "auto"],
      document_status: ["ready", "needs_review", "delivered", "archived"],
      document_type: [
        "post_meeting_analysis",
        "internal_memo",
        "client_summary",
        "task_checklist",
        "internal_email_draft",
        "client_email_draft",
        "pre_meeting_brief",
        "daily_sync",
        "upload",
        "other",
      ],
      embedding_source: [
        "meeting_document",
        "upload",
        "knowledge_base",
        "transcript",
      ],
      fee_tier: ["low", "mid", "high"],
      folder_visibility: ["all", "restricted"],
      integration_key: [
        "recall",
        "openai",
        "anthropic",
        "resend",
        "r2",
        "ms_graph",
        "logto",
        "supabase",
      ],
      meeting_source: ["calendar", "manual"],
      meeting_type: [
        "weekly_sync",
        "biweekly_cadence",
        "monthly_review",
        "qbr",
        "technical_review",
        "kickoff",
        "ad_hoc",
      ],
      notification_type: [
        "documents_ready",
        "needs_attention",
        "task_assigned",
        "kb_expiring",
        "calendar_disconnect",
        "pipeline_failed",
      ],
      pipeline_run_source: ["recall", "manual_upload"],
      pipeline_run_status: ["success", "failed", "partial"],
      pipeline_status: [
        "scheduled",
        "in_progress",
        "awaiting_transcript",
        "processing",
        "complete",
        "needs_attention",
        "cancelled",
      ],
      relationship_trend: ["improving", "stable", "declining"],
      task_status: ["open", "in_progress", "complete"],
      user_role: ["admin", "standard", "viewer"],
    },
  },
} as const
