/* Generated compatibility note: this repo currently relies on permissive JSONB typing
   across many generated table and RPC shapes, so keep Json broad until the call sites
   are narrowed coherently. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

export type Vector = number[] | string;

type GeneratedTable<Row, RequiredInsert extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, RequiredInsert> & Partial<Omit<Row, RequiredInsert>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
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
      teaching_calendar_optins: {
        Row: { service_id: string; user_id: string; created_at: string };
        Insert: { service_id: string; user_id: string; created_at?: string };
        Update: { service_id?: string; user_id?: string; created_at?: string };
        Relationships: [];
      };
      on_call_services: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          is_demo: boolean;
          name: string;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          name: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          name?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [];
      };
      on_call_service_sites: {
        Row: {
          id: string;
          service_id: string;
          name: string;
        };
        Insert: {
          id?: string;
          service_id: string;
          name: string;
        };
        Update: {
          id?: string;
          service_id?: string;
          name?: string;
        };
        Relationships: [];
      };
      on_call_service_members: {
        Row: {
          clinical_reviewer: boolean;
          display_name: string | null;
          joined_at: string;
          revoked_at: string | null;
          role: string;
          service_id: string;
          user_id: string;
        };
        Insert: {
          clinical_reviewer?: boolean;
          display_name?: string | null;
          joined_at?: string;
          revoked_at?: string | null;
          role: string;
          service_id: string;
          user_id: string;
        };
        Update: {
          clinical_reviewer?: boolean;
          display_name?: string | null;
          joined_at?: string;
          revoked_at?: string | null;
          role?: string;
          service_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      on_call_service_invitations: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          invited_email: string | null;
          issued_by: string | null;
          issued_via_mode: string | null;
          revoked_at: string | null;
          role: string;
          service_id: string;
          token_hash: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          invited_email?: string | null;
          issued_by?: string | null;
          issued_via_mode?: string | null;
          revoked_at?: string | null;
          role: string;
          service_id: string;
          token_hash: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          invited_email?: string | null;
          issued_by?: string | null;
          issued_via_mode?: string | null;
          revoked_at?: string | null;
          role?: string;
          service_id?: string;
          token_hash?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [];
      };
      on_call_service_entries: {
        Row: {
          id: string;
          service_id: string;
          site_id: string | null;
          revision: number;
          content: Json;
          author_id: string | null;
          status: string;
          published_content: Json | null;
          published_revision: number | null;
          published_author_id: string | null;
          published_reviewed_by: string | null;
          published_reviewed_at: string | null;
          review_comment: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          service_id: string;
          site_id?: string | null;
          revision?: number;
          content: Json;
          author_id?: string | null;
          status: string;
          published_content?: Json | null;
          published_revision?: number | null;
          published_author_id?: string | null;
          published_reviewed_by?: string | null;
          published_reviewed_at?: string | null;
          review_comment?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          service_id?: string;
          site_id?: string | null;
          revision?: number;
          content?: Json;
          author_id?: string | null;
          status?: string;
          published_content?: Json | null;
          published_revision?: number | null;
          published_author_id?: string | null;
          published_reviewed_by?: string | null;
          published_reviewed_at?: string | null;
          review_comment?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      on_call_service_reports: {
        Row: {
          id: string;
          service_id: string;
          entry_id: string;
          reported_by: string | null;
          reason: string;
          status: string;
          resolution: string;
          resolved_by: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          service_id: string;
          entry_id: string;
          reported_by?: string | null;
          reason: string;
          status?: string;
          resolution?: string;
          resolved_by?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          service_id?: string;
          entry_id?: string;
          reported_by?: string | null;
          reason?: string;
          status?: string;
          resolution?: string;
          resolved_by?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      on_call_service_orientation: {
        Row: {
          service_id: string;
          user_id: string;
          site_id: string;
          entry_id: string;
          rotation: string;
          revision: number;
          completed_at: string;
        };
        Insert: {
          service_id: string;
          user_id: string;
          site_id: string;
          entry_id: string;
          rotation: string;
          revision: number;
          completed_at?: string;
        };
        Update: {
          service_id?: string;
          user_id?: string;
          site_id?: string;
          entry_id?: string;
          rotation?: string;
          revision?: number;
          completed_at?: string;
        };
        Relationships: [];
      };
      cme_evidence: {
        Row: {
          id: string;
          owner_id: string;
          entry_id: string;
          file_name: string;
          content_type: string;
          byte_size: number;
          sha256: string;
          storage_path: string;
          kind: string;
          redaction_confirmed: boolean;
          preview_confirmed: boolean;
          uploaded_at: string;
          removed_at: string | null;
          removal_reason: string | null;
        };
        Insert: {
          id: string;
          owner_id: string;
          entry_id: string;
          file_name: string;
          content_type: string;
          byte_size: number;
          sha256: string;
          storage_path: string;
          kind: string;
          redaction_confirmed: boolean;
          preview_confirmed: boolean;
          uploaded_at?: string;
          removed_at?: string | null;
          removal_reason?: string | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          entry_id?: string;
          file_name?: string;
          content_type?: string;
          byte_size?: number;
          sha256?: string;
          storage_path?: string;
          kind?: string;
          redaction_confirmed?: boolean;
          preview_confirmed?: boolean;
          uploaded_at?: string;
          removed_at?: string | null;
          removal_reason?: string | null;
        };
        Relationships: [];
      };
      api_rate_limit_subjects: {
        Row: {
          bucket: string;
          request_count: number;
          subject_key: string;
          updated_at: string;
          window_start: string;
        };
        Insert: {
          bucket: string;
          request_count?: number;
          subject_key: string;
          updated_at?: string;
          window_start?: string;
        };
        Update: {
          bucket?: string;
          request_count?: number;
          subject_key?: string;
          updated_at?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      api_rate_limits: {
        Row: {
          bucket: string;
          owner_id: string;
          request_count: number;
          updated_at: string;
          window_start: string;
        };
        Insert: {
          bucket: string;
          owner_id: string;
          request_count?: number;
          updated_at?: string;
          window_start?: string;
        };
        Update: {
          bucket?: string;
          owner_id?: string;
          request_count?: number;
          updated_at?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          metadata: Json;
          owner_id: string | null;
          resource_id: string | null;
          resource_type: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
        };
        Relationships: [];
      };
      clinical_registry_record_sources: {
        Row: {
          created_at: string;
          document_id: string;
          id: string;
          note: string | null;
          owner_id: string;
          record_id: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          id?: string;
          note?: string | null;
          owner_id: string;
          record_id: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          id?: string;
          note?: string | null;
          owner_id?: string;
          record_id?: string;
        };
        Relationships: [];
      };
      clinical_quality_feedback_triage: {
        Row: {
          created_at: string;
          owner_role: string;
          owner_user_id: string | null;
          resolution_code: string | null;
          resolved_at: string | null;
          retest_reference: string;
          signal_id: string;
          signal_type: string;
          status: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          owner_role?: string;
          owner_user_id?: string | null;
          resolution_code?: string | null;
          resolved_at?: string | null;
          retest_reference?: string;
          signal_id: string;
          signal_type: string;
          status?: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          owner_role?: string;
          owner_user_id?: string | null;
          resolution_code?: string | null;
          resolved_at?: string | null;
          retest_reference?: string;
          signal_id?: string;
          signal_type?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [];
      };
      clinical_quality_feedback_triage_events: {
        Row: {
          actor_user_id: string;
          created_at: string;
          id: string;
          owner_role: string;
          owner_user_id: string | null;
          resolution_code: string | null;
          retest_reference: string;
          signal_id: string;
          signal_type: string;
          status: string;
        };
        Insert: {
          actor_user_id: string;
          created_at?: string;
          id?: string;
          owner_role: string;
          owner_user_id?: string | null;
          resolution_code?: string | null;
          retest_reference?: string;
          signal_id: string;
          signal_type: string;
          status: string;
        };
        Update: {
          actor_user_id?: string;
          created_at?: string;
          id?: string;
          owner_role?: string;
          owner_user_id?: string | null;
          resolution_code?: string | null;
          retest_reference?: string;
          signal_id?: string;
          signal_type?: string;
          status?: string;
        };
        Relationships: [];
      };
      clinical_registry_records: {
        Row: {
          best_use: string | null;
          catalog_payload: Json;
          catalogue_label: string | null;
          catchments: string[];
          contacts: Json;
          cost: string | null;
          created_at: string;
          criteria: Json;
          eligibility: string | null;
          id: string;
          kind: string;
          last_reviewed_at: string | null;
          location: string | null;
          navigator_query: string | null;
          owner_id: string;
          primary_contact: Json | null;
          referral: string | null;
          referral_info: Json;
          review_due_at: string | null;
          route: string | null;
          slug: string;
          source: Json;
          source_status: string;
          status_chips: Json;
          subtitle: string | null;
          summary_cards: Json;
          tags: string[];
          title: string;
          updated_at: string;
          validation_status: string;
          verification: Json;
        };
        Insert: {
          best_use?: string | null;
          catalog_payload?: Json;
          catalogue_label?: string | null;
          catchments?: string[];
          contacts?: Json;
          cost?: string | null;
          created_at?: string;
          criteria?: Json;
          eligibility?: string | null;
          id?: string;
          kind: string;
          last_reviewed_at?: string | null;
          location?: string | null;
          navigator_query?: string | null;
          owner_id: string;
          primary_contact?: Json | null;
          referral?: string | null;
          referral_info?: Json;
          review_due_at?: string | null;
          route?: string | null;
          slug: string;
          source?: Json;
          source_status?: string;
          status_chips?: Json;
          subtitle?: string | null;
          summary_cards?: Json;
          tags?: string[];
          title: string;
          updated_at?: string;
          validation_status?: string;
          verification?: Json;
        };
        Update: {
          best_use?: string | null;
          catalog_payload?: Json;
          catalogue_label?: string | null;
          catchments?: string[];
          contacts?: Json;
          cost?: string | null;
          created_at?: string;
          criteria?: Json;
          eligibility?: string | null;
          id?: string;
          kind?: string;
          last_reviewed_at?: string | null;
          location?: string | null;
          navigator_query?: string | null;
          owner_id?: string;
          primary_contact?: Json | null;
          referral?: string | null;
          referral_info?: Json;
          review_due_at?: string | null;
          route?: string | null;
          slug?: string;
          source?: Json;
          source_status?: string;
          status_chips?: Json;
          subtitle?: string | null;
          summary_cards?: Json;
          tags?: string[];
          title?: string;
          updated_at?: string;
          validation_status?: string;
          verification?: Json;
        };
        Relationships: [];
      };
      differential_records: {
        Row: {
          clinical_hinge: string | null;
          created_at: string;
          id: string;
          kind: string;
          last_reviewed_at: string | null;
          owner_id: string;
          payload: Json;
          review_due_at: string | null;
          slug: string;
          source: Json;
          source_status: string;
          status: string;
          subtitle: string | null;
          tags: string[];
          title: string;
          updated_at: string;
          validation_status: string;
        };
        Insert: {
          clinical_hinge?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          last_reviewed_at?: string | null;
          owner_id: string;
          payload?: Json;
          review_due_at?: string | null;
          slug: string;
          source?: Json;
          source_status?: string;
          status: string;
          subtitle?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          validation_status?: string;
        };
        Update: {
          clinical_hinge?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          last_reviewed_at?: string | null;
          owner_id?: string;
          payload?: Json;
          review_due_at?: string | null;
          slug?: string;
          source?: Json;
          source_status?: string;
          status?: string;
          subtitle?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          validation_status?: string;
        };
        Relationships: [];
      };
      document_chunks: {
        Row: {
          anchor_id: string | null;
          chunk_index: number;
          content: string;
          content_hash: string | null;
          created_at: string;
          document_id: string;
          embedding: Vector;
          heading_level: number | null;
          id: string;
          image_ids: string[];
          index_generation_id: string | null;
          metadata: Json;
          page_number: number | null;
          parent_heading: string | null;
          retrieval_synopsis: string | null;
          search_tsv: unknown;
          section_heading: string | null;
          section_path: string[];
          token_estimate: number;
        };
        Insert: {
          anchor_id?: string | null;
          chunk_index: number;
          content: string;
          content_hash?: string | null;
          created_at?: string;
          document_id: string;
          embedding: Vector;
          heading_level?: number | null;
          id?: string;
          image_ids?: string[];
          index_generation_id?: string | null;
          metadata?: Json;
          page_number?: number | null;
          parent_heading?: string | null;
          retrieval_synopsis?: string | null;
          search_tsv?: unknown;
          section_heading?: string | null;
          section_path?: string[];
          token_estimate?: number;
        };
        Update: {
          anchor_id?: string | null;
          chunk_index?: number;
          content?: string;
          content_hash?: string | null;
          created_at?: string;
          document_id?: string;
          embedding?: Vector;
          heading_level?: number | null;
          id?: string;
          image_ids?: string[];
          index_generation_id?: string | null;
          metadata?: Json;
          page_number?: number | null;
          parent_heading?: string | null;
          retrieval_synopsis?: string | null;
          search_tsv?: unknown;
          section_heading?: string | null;
          section_path?: string[];
          token_estimate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_corpus_access_snapshots: {
        Row: {
          published_label_ids: string[];
          published_summary_ids: string[];
          published_table_fact_ids: string[];
          activation_id: string;
          captured_at: string;
          document_id: string;
          owner_id: string | null;
          public_corpus_present: boolean;
          public_corpus_value: Json | null;
        };
        Insert: {
          published_label_ids?: string[];
          published_summary_ids?: string[];
          published_table_fact_ids?: string[];
          activation_id: string;
          captured_at?: string;
          document_id: string;
          owner_id?: string | null;
          public_corpus_present: boolean;
          public_corpus_value?: Json | null;
        };
        Update: {
          published_label_ids?: string[];
          published_summary_ids?: string[];
          published_table_fact_ids?: string[];
          activation_id?: string;
          captured_at?: string;
          document_id?: string;
          owner_id?: string | null;
          public_corpus_present?: boolean;
          public_corpus_value?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_corpus_access_snapshots_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_corpus_access_snapshots_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_corpus_access_state: {
        Row: {
          activated_at: string | null;
          activation_id: string | null;
          mode: string;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          activated_at?: string | null;
          activation_id?: string | null;
          mode: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          activated_at?: string | null;
          activation_id?: string | null;
          mode?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_embedding_fields: {
        Row: {
          content: string;
          content_hash: string;
          created_at: string;
          document_id: string;
          embedding: Vector;
          field_type: string;
          id: string;
          metadata: Json;
          owner_id: string | null;
          search_tsv: unknown;
          source_chunk_id: string | null;
        };
        Insert: {
          content: string;
          content_hash: string;
          created_at?: string;
          document_id: string;
          embedding: Vector;
          field_type: string;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
        };
        Update: {
          content?: string;
          content_hash?: string;
          created_at?: string;
          document_id?: string;
          embedding?: Vector;
          field_type?: string;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_embedding_fields_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_embedding_fields_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_embedding_fields_source_chunk_id_fkey";
            columns: ["source_chunk_id"];
            isOneToOne: false;
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
        ];
      };
      document_images: {
        Row: {
          bbox: Json | null;
          caption: string;
          caption_confidence: number | null;
          clinical_priority_score: number | null;
          clinical_relevance_score: number;
          created_at: string;
          crop_completeness: number | null;
          document_id: string;
          height: number | null;
          id: string;
          image_hash: string | null;
          image_quality_score: number | null;
          image_type: string;
          labels: string[];
          metadata: Json;
          mime_type: string;
          ocr_text_density: number | null;
          page_number: number | null;
          perceptual_hash: string | null;
          searchable: boolean;
          skip_reason: string | null;
          source_kind: string;
          storage_path: string;
          structured_extraction_confidence: number | null;
          visual_duplicate_group: string | null;
          width: number | null;
        };
        Insert: {
          bbox?: Json | null;
          caption?: string;
          caption_confidence?: number | null;
          clinical_priority_score?: number | null;
          clinical_relevance_score?: number;
          created_at?: string;
          crop_completeness?: number | null;
          document_id: string;
          height?: number | null;
          id?: string;
          image_hash?: string | null;
          image_quality_score?: number | null;
          image_type?: string;
          labels?: string[];
          metadata?: Json;
          mime_type?: string;
          ocr_text_density?: number | null;
          page_number?: number | null;
          perceptual_hash?: string | null;
          searchable?: boolean;
          skip_reason?: string | null;
          source_kind?: string;
          storage_path: string;
          structured_extraction_confidence?: number | null;
          visual_duplicate_group?: string | null;
          width?: number | null;
        };
        Update: {
          bbox?: Json | null;
          caption?: string;
          caption_confidence?: number | null;
          clinical_priority_score?: number | null;
          clinical_relevance_score?: number;
          created_at?: string;
          crop_completeness?: number | null;
          document_id?: string;
          height?: number | null;
          id?: string;
          image_hash?: string | null;
          image_quality_score?: number | null;
          image_type?: string;
          labels?: string[];
          metadata?: Json;
          mime_type?: string;
          ocr_text_density?: number | null;
          page_number?: number | null;
          perceptual_hash?: string | null;
          searchable?: boolean;
          skip_reason?: string | null;
          source_kind?: string;
          storage_path?: string;
          structured_extraction_confidence?: number | null;
          visual_duplicate_group?: string | null;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_images_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_images_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_index_quality: {
        Row: {
          anchor_coverage: number | null;
          document_id: string;
          extraction_quality: string;
          issues: string[];
          metrics: Json;
          model_fallback_rate: number | null;
          noisy_unit_rate: number | null;
          owner_id: string | null;
          quality_score: number;
          retrievable_visual_hit: boolean | null;
          source_span_coverage: number | null;
          typed_unit_coverage: number | null;
          updated_at: string;
        };
        Insert: {
          anchor_coverage?: number | null;
          document_id: string;
          extraction_quality?: string;
          issues?: string[];
          metrics?: Json;
          model_fallback_rate?: number | null;
          noisy_unit_rate?: number | null;
          owner_id?: string | null;
          quality_score?: number;
          retrievable_visual_hit?: boolean | null;
          source_span_coverage?: number | null;
          typed_unit_coverage?: number | null;
          updated_at?: string;
        };
        Update: {
          anchor_coverage?: number | null;
          document_id?: string;
          extraction_quality?: string;
          issues?: string[];
          metrics?: Json;
          model_fallback_rate?: number | null;
          noisy_unit_rate?: number | null;
          owner_id?: string | null;
          quality_score?: number;
          retrievable_visual_hit?: boolean | null;
          source_span_coverage?: number | null;
          typed_unit_coverage?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_index_quality_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_index_quality_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_index_units: {
        Row: {
          artifact_generation_id: string | null;
          content: string;
          created_at: string;
          document_id: string;
          embedding: Vector;
          extraction_mode: string;
          heading_path: string[];
          id: string;
          metadata: Json;
          normalized_terms: string[];
          owner_id: string | null;
          producer: string | null;
          page_end: number | null;
          page_start: number | null;
          quality_score: number;
          search_tsv: unknown;
          source_chunk_id: string | null;
          source_image_id: string | null;
          source_span: Json | null;
          title: string;
          unit_type: string;
          updated_at: string;
          index_generation_id: string | null;
        };
        Insert: {
          artifact_generation_id?: string | null;
          content: string;
          created_at?: string;
          document_id: string;
          embedding: Vector;
          extraction_mode?: string;
          heading_path?: string[];
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          producer?: string | null;
          page_end?: number | null;
          page_start?: number | null;
          quality_score?: number;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
          source_image_id?: string | null;
          source_span?: Json | null;
          title: string;
          unit_type: string;
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Update: {
          artifact_generation_id?: string | null;
          content?: string;
          created_at?: string;
          document_id?: string;
          embedding?: Vector;
          extraction_mode?: string;
          heading_path?: string[];
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          producer?: string | null;
          page_end?: number | null;
          page_start?: number | null;
          quality_score?: number;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
          source_image_id?: string | null;
          source_span?: Json | null;
          title?: string;
          unit_type?: string;
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_index_units_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_index_units_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_index_units_source_chunk_id_fkey";
            columns: ["source_chunk_id"];
            isOneToOne: false;
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_index_units_source_image_id_fkey";
            columns: ["source_image_id"];
            isOneToOne: false;
            referencedRelation: "document_images";
            referencedColumns: ["id"];
          },
        ];
      };
      document_labels: {
        Row: {
          confidence: number;
          created_at: string;
          document_id: string;
          id: string;
          label: string;
          label_type: string;
          metadata: Json;
          owner_id: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          confidence?: number;
          created_at?: string;
          document_id: string;
          id?: string;
          label: string;
          label_type: string;
          metadata?: Json;
          owner_id?: string | null;
          source?: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          document_id?: string;
          id?: string;
          label?: string;
          label_type?: string;
          metadata?: Json;
          owner_id?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_labels_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_labels_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_memory_cards: {
        Row: {
          artifact_generation_id: string | null;
          card_type: string;
          confidence: number;
          content: string;
          created_at: string;
          document_id: string;
          embedding: Vector;
          id: string;
          metadata: Json;
          normalized_terms: string[];
          owner_id: string | null;
          producer: string | null;
          page_number: number | null;
          search_tsv: unknown;
          section_id: string | null;
          source_chunk_ids: string[];
          source_image_ids: string[];
          title: string;
          updated_at: string;
          index_generation_id: string | null;
        };
        Insert: {
          artifact_generation_id?: string | null;
          card_type: string;
          confidence?: number;
          content: string;
          created_at?: string;
          document_id: string;
          embedding: Vector;
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          producer?: string | null;
          page_number?: number | null;
          search_tsv?: unknown;
          section_id?: string | null;
          source_chunk_ids?: string[];
          source_image_ids?: string[];
          title: string;
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Update: {
          artifact_generation_id?: string | null;
          card_type?: string;
          confidence?: number;
          content?: string;
          created_at?: string;
          document_id?: string;
          embedding?: Vector;
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          producer?: string | null;
          page_number?: number | null;
          search_tsv?: unknown;
          section_id?: string | null;
          source_chunk_ids?: string[];
          source_image_ids?: string[];
          title?: string;
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_memory_cards_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_memory_cards_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_memory_cards_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "document_sections";
            referencedColumns: ["id"];
          },
        ];
      };
      document_pages: {
        Row: {
          created_at: string;
          document_id: string;
          id: string;
          metadata: Json;
          ocr_used: boolean;
          page_number: number;
          text: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          id?: string;
          metadata?: Json;
          ocr_used?: boolean;
          page_number: number;
          text?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          id?: string;
          metadata?: Json;
          ocr_used?: boolean;
          page_number?: number;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_pages_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_pages_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_publication_approvals: {
        Row: {
          approved_at: string;
          approving_operator_id: string;
          decision: string;
          document_id: string;
          evidence_references: string[];
          expected_prior_owner_id: string;
          id: string;
          manifest_digest: string;
          reason: string;
          reviewed_index_generation_id: string | null;
          reviewed_state_digest: string | null;
          source_catalogue_key: string | null;
          source_policy_version: string | null;
        };
        Insert: {
          approved_at?: string;
          approving_operator_id: string;
          decision: string;
          document_id: string;
          evidence_references: string[];
          expected_prior_owner_id: string;
          id?: string;
          manifest_digest: string;
          reason: string;
          reviewed_index_generation_id?: string | null;
          reviewed_state_digest?: string | null;
          source_catalogue_key?: string | null;
          source_policy_version?: string | null;
        };
        Update: {
          approved_at?: string;
          approving_operator_id?: string;
          decision?: string;
          document_id?: string;
          evidence_references?: string[];
          expected_prior_owner_id?: string;
          id?: string;
          manifest_digest?: string;
          reason?: string;
          reviewed_index_generation_id?: string | null;
          reviewed_state_digest?: string | null;
          source_catalogue_key?: string | null;
          source_policy_version?: string | null;
        };
        Relationships: [];
      };
      public_source_policy_entries: {
        Row: {
          canonical_host: string;
          canonical_url: string;
          content_mode: string;
          created_at: string;
          exact_document_licence: string;
          lifecycle: string;
          policy_digest: string;
          policy_version: string;
          source_catalogue_key: string;
        };
        Insert: {
          canonical_host: string;
          canonical_url: string;
          content_mode: string;
          created_at?: string;
          exact_document_licence: string;
          lifecycle: string;
          policy_digest: string;
          policy_version: string;
          source_catalogue_key: string;
        };
        Update: {
          canonical_host?: string;
          canonical_url?: string;
          content_mode?: string;
          created_at?: string;
          exact_document_licence?: string;
          lifecycle?: string;
          policy_digest?: string;
          policy_version?: string;
          source_catalogue_key?: string;
        };
        Relationships: [];
      };
      public_source_activation_events: {
        Row: {
          activation_sequence: number;
          created_at: string;
          decision: string;
          evidence_references: string[];
          id: string;
          manifest_digest: string;
          operator_id: string;
          policy_digest: string;
          policy_version: string;
          reason: string;
          source_catalogue_key: string;
        };
        Insert: {
          activation_sequence?: never;
          created_at?: string;
          decision: string;
          evidence_references: string[];
          id?: string;
          manifest_digest: string;
          operator_id: string;
          policy_digest: string;
          policy_version: string;
          reason: string;
          source_catalogue_key: string;
        };
        Update: {
          activation_sequence?: never;
          created_at?: string;
          decision?: string;
          evidence_references?: string[];
          id?: string;
          manifest_digest?: string;
          operator_id?: string;
          policy_digest?: string;
          policy_version?: string;
          reason?: string;
          source_catalogue_key?: string;
        };
        Relationships: [];
      };
      public_source_activation_guards: {
        Row: {
          backend_pid: number;
          created_at: string;
          token: string;
          transaction_id: number;
          version_id: string;
        };
        Insert: {
          backend_pid: number;
          created_at?: string;
          token: string;
          transaction_id: number;
          version_id: string;
        };
        Update: {
          backend_pid?: number;
          created_at?: string;
          token?: string;
          transaction_id?: number;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "public_source_activation_guards_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "public_source_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      public_source_cleanup_mutation_guards: {
        Row: {
          backend_pid: number;
          created_at: string;
          operation: string;
          public_source_reservation_id: string;
          public_source_upload_attempt_id: string;
          token: string;
          transaction_id: number;
        };
        Insert: {
          backend_pid: number;
          created_at?: string;
          operation: string;
          public_source_reservation_id: string;
          public_source_upload_attempt_id: string;
          token: string;
          transaction_id: number;
        };
        Update: {
          backend_pid?: number;
          created_at?: string;
          operation?: string;
          public_source_reservation_id?: string;
          public_source_upload_attempt_id?: string;
          token?: string;
          transaction_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "public_source_cleanup_mutation_guards_public_source_upload_attempt_id_fkey";
            columns: ["public_source_upload_attempt_id"];
            isOneToOne: false;
            referencedRelation: "public_source_upload_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_source_cleanup_mutation_guards_public_source_reservation_id_fkey";
            columns: ["public_source_reservation_id"];
            isOneToOne: false;
            referencedRelation: "public_source_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      public_source_upload_attempts: {
        Row: {
          claim_expires_at: string;
          claim_token: string;
          cleanup_not_before: string;
          created_at: string;
          id: string;
          signed_authority_digest: string | null;
          signed_authority_expires_at: string | null;
          state: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          version_id: string;
        };
        Insert: {
          claim_expires_at: string;
          claim_token: string;
          cleanup_not_before: string;
          created_at?: string;
          id: string;
          signed_authority_digest?: string | null;
          signed_authority_expires_at?: string | null;
          state: string;
          storage_bucket: string;
          storage_path: string;
          updated_at?: string;
          version_id: string;
        };
        Update: {
          claim_expires_at?: string;
          claim_token?: string;
          cleanup_not_before?: string;
          created_at?: string;
          id?: string;
          signed_authority_digest?: string | null;
          signed_authority_expires_at?: string | null;
          state?: string;
          storage_bucket?: string;
          storage_path?: string;
          updated_at?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "public_source_upload_attempts_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "public_source_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      public_source_versions: {
        Row: {
          activation_event_id: string;
          activation_sequence: number;
          content_hash: string;
          created_at: string;
          current_upload_attempt_id: string | null;
          exact_canonical_url: string;
          exact_version: string;
          exact_version_url: string;
          extraction_index_generation_id: string | null;
          finalized_upload_attempt_id: string | null;
          id: string;
          intended_disposition: string;
          licence_evidence_digest: string;
          lifecycle: string;
          raw_response_byte_count: number;
          raw_response_hash: string;
          reservation_key: string;
          reserved_document_id: string;
          reserved_storage_path: string;
          storage_bucket: string;
          upload_lease_token: string;
          upload_lease_expires_at: string;
          upload_state: string;
          retrieved_at: string;
          review_queued_at: string | null;
          review_reason: string | null;
          source_catalogue_key: string;
          source_policy_digest: string;
          source_policy_version: string;
          staging_document_id: string | null;
          steward_id: string;
          supersedes_version_id: string | null;
          updated_at: string;
        };
        Insert: {
          activation_event_id: string;
          activation_sequence: number;
          content_hash: string;
          created_at?: string;
          current_upload_attempt_id?: string | null;
          exact_canonical_url: string;
          exact_version: string;
          exact_version_url: string;
          extraction_index_generation_id?: string | null;
          finalized_upload_attempt_id?: string | null;
          id: string;
          intended_disposition: string;
          licence_evidence_digest: string;
          lifecycle?: string;
          raw_response_byte_count: number;
          raw_response_hash: string;
          reservation_key: string;
          reserved_document_id: string;
          reserved_storage_path: string;
          storage_bucket: string;
          upload_lease_token: string;
          upload_lease_expires_at: string;
          upload_state?: string;
          retrieved_at: string;
          review_queued_at?: string | null;
          review_reason?: string | null;
          source_catalogue_key: string;
          source_policy_digest: string;
          source_policy_version: string;
          staging_document_id?: string | null;
          steward_id: string;
          supersedes_version_id?: string | null;
          updated_at?: string;
        };
        Update: {
          activation_event_id?: string;
          activation_sequence?: number;
          content_hash?: string;
          created_at?: string;
          current_upload_attempt_id?: string | null;
          exact_canonical_url?: string;
          exact_version?: string;
          exact_version_url?: string;
          extraction_index_generation_id?: string | null;
          finalized_upload_attempt_id?: string | null;
          id?: string;
          intended_disposition?: string;
          licence_evidence_digest?: string;
          lifecycle?: string;
          raw_response_byte_count?: number;
          raw_response_hash?: string;
          reservation_key?: string;
          reserved_document_id?: string;
          reserved_storage_path?: string;
          storage_bucket?: string;
          upload_lease_token?: string;
          upload_lease_expires_at?: string;
          upload_state?: string;
          retrieved_at?: string;
          review_queued_at?: string | null;
          review_reason?: string | null;
          source_catalogue_key?: string;
          source_policy_digest?: string;
          source_policy_version?: string;
          staging_document_id?: string | null;
          steward_id?: string;
          supersedes_version_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "public_source_versions_current_upload_attempt_id_fkey";
            columns: ["current_upload_attempt_id"];
            isOneToOne: false;
            referencedRelation: "public_source_upload_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_source_versions_finalized_upload_attempt_id_fkey";
            columns: ["finalized_upload_attempt_id"];
            isOneToOne: false;
            referencedRelation: "public_source_upload_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_source_versions_activation_event_id_fkey";
            columns: ["activation_event_id"];
            isOneToOne: false;
            referencedRelation: "public_source_activation_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_source_versions_source_catalogue_key_fkey";
            columns: ["source_catalogue_key"];
            isOneToOne: false;
            referencedRelation: "public_source_policy_entries";
            referencedColumns: ["source_catalogue_key"];
          },
          {
            foreignKeyName: "public_source_versions_staging_document_id_fkey";
            columns: ["staging_document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_source_versions_supersedes_version_id_fkey";
            columns: ["supersedes_version_id"];
            isOneToOne: false;
            referencedRelation: "public_source_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      document_sections: {
        Row: {
          artifact_generation_id: string | null;
          chunk_ids: string[];
          created_at: string;
          document_id: string;
          extraction_quality: string;
          heading: string;
          heading_path: string[];
          id: string;
          metadata: Json;
          owner_id: string | null;
          producer: string | null;
          page_end: number | null;
          page_start: number | null;
          section_index: number;
          summary: string;
          tags: string[];
          updated_at: string;
          index_generation_id: string | null;
        };
        Insert: {
          artifact_generation_id?: string | null;
          chunk_ids?: string[];
          created_at?: string;
          document_id: string;
          extraction_quality?: string;
          heading: string;
          heading_path?: string[];
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          producer?: string | null;
          page_end?: number | null;
          page_start?: number | null;
          section_index: number;
          summary?: string;
          tags?: string[];
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Update: {
          artifact_generation_id?: string | null;
          chunk_ids?: string[];
          created_at?: string;
          document_id?: string;
          extraction_quality?: string;
          heading?: string;
          heading_path?: string[];
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          producer?: string | null;
          page_end?: number | null;
          page_start?: number | null;
          section_index?: number;
          summary?: string;
          tags?: string[];
          updated_at?: string;
          index_generation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_sections_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_sections_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_summaries: {
        Row: {
          clinical_specifics: Json;
          created_at: string;
          document_id: string;
          generated_at: string;
          id: string;
          metadata: Json;
          model: string | null;
          owner_id: string | null;
          source_chunk_ids: string[];
          source_image_ids: string[];
          summary: string;
          updated_at: string;
        };
        Insert: {
          clinical_specifics?: Json;
          created_at?: string;
          document_id: string;
          generated_at?: string;
          id?: string;
          metadata?: Json;
          model?: string | null;
          owner_id?: string | null;
          source_chunk_ids?: string[];
          source_image_ids?: string[];
          summary: string;
          updated_at?: string;
        };
        Update: {
          clinical_specifics?: Json;
          created_at?: string;
          document_id?: string;
          generated_at?: string;
          id?: string;
          metadata?: Json;
          model?: string | null;
          owner_id?: string | null;
          source_chunk_ids?: string[];
          source_image_ids?: string[];
          summary?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_summaries_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_summaries_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_table_facts: {
        Row: {
          action: string | null;
          clinical_parameter: string | null;
          created_at: string;
          document_id: string;
          id: string;
          metadata: Json;
          normalized_terms: string[];
          owner_id: string | null;
          page_number: number | null;
          row_label: string | null;
          search_tsv: unknown;
          source_chunk_id: string | null;
          source_image_id: string | null;
          table_title: string | null;
          threshold_value: string | null;
        };
        Insert: {
          action?: string | null;
          clinical_parameter?: string | null;
          created_at?: string;
          document_id: string;
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          page_number?: number | null;
          row_label?: string | null;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
          source_image_id?: string | null;
          table_title?: string | null;
          threshold_value?: string | null;
        };
        Update: {
          action?: string | null;
          clinical_parameter?: string | null;
          created_at?: string;
          document_id?: string;
          id?: string;
          metadata?: Json;
          normalized_terms?: string[];
          owner_id?: string | null;
          page_number?: number | null;
          row_label?: string | null;
          search_tsv?: unknown;
          source_chunk_id?: string | null;
          source_image_id?: string | null;
          table_title?: string | null;
          threshold_value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_table_facts_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_table_facts_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_table_facts_source_chunk_id_fkey";
            columns: ["source_chunk_id"];
            isOneToOne: false;
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_table_facts_source_image_id_fkey";
            columns: ["source_image_id"];
            isOneToOne: false;
            referencedRelation: "document_images";
            referencedColumns: ["id"];
          },
        ];
      };
      document_title_words: {
        Row: {
          document_id: string;
          word: string;
        };
        Insert: {
          document_id: string;
          word: string;
        };
        Update: {
          document_id?: string;
          word?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_title_words_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "document_title_words_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          chunk_count: number;
          content_hash: string | null;
          created_at: string;
          description: string | null;
          error_message: string | null;
          file_name: string;
          file_size: number;
          file_type: string;
          id: string;
          image_count: number;
          import_batch_id: string | null;
          index_generation_id: string | null;
          metadata: Json;
          owner_id: string | null;
          page_count: number;
          search_tsv: unknown;
          source_path: string | null;
          status: string;
          storage_path: string;
          title: string;
          title_search_tsv: unknown;
          updated_at: string;
        };
        Insert: {
          chunk_count?: number;
          content_hash?: string | null;
          created_at?: string;
          description?: string | null;
          error_message?: string | null;
          file_name: string;
          file_size?: number;
          file_type: string;
          id?: string;
          image_count?: number;
          import_batch_id?: string | null;
          index_generation_id?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          page_count?: number;
          search_tsv?: unknown;
          source_path?: string | null;
          status?: string;
          storage_path: string;
          title: string;
          title_search_tsv?: unknown;
          updated_at?: string;
        };
        Update: {
          chunk_count?: number;
          content_hash?: string | null;
          created_at?: string;
          description?: string | null;
          error_message?: string | null;
          file_name?: string;
          file_size?: number;
          file_type?: string;
          id?: string;
          image_count?: number;
          import_batch_id?: string | null;
          index_generation_id?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          page_count?: number;
          search_tsv?: unknown;
          source_path?: string | null;
          status?: string;
          storage_path?: string;
          title?: string;
          title_search_tsv?: unknown;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      image_caption_cache: {
        Row: {
          caption: string;
          created_at: string;
          id: string;
          image_hash: string;
          metadata: Json;
          mime_type: string | null;
          model: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          caption: string;
          created_at?: string;
          id?: string;
          image_hash: string;
          metadata?: Json;
          mime_type?: string | null;
          model: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          caption?: string;
          created_at?: string;
          id?: string;
          image_hash?: string;
          metadata?: Json;
          mime_type?: string | null;
          model?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      import_batches: {
        Row: {
          completed_at: string | null;
          created_at: string;
          failed_files: number;
          id: string;
          include_glob: string;
          metadata: Json;
          name: string;
          owner_id: string | null;
          queued_files: number;
          skipped_files: number;
          source_root: string | null;
          status: string;
          total_bytes: number;
          total_files: number;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          failed_files?: number;
          id?: string;
          include_glob?: string;
          metadata?: Json;
          name: string;
          owner_id?: string | null;
          queued_files?: number;
          skipped_files?: number;
          source_root?: string | null;
          status?: string;
          total_bytes?: number;
          total_files?: number;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          failed_files?: number;
          id?: string;
          include_glob?: string;
          metadata?: Json;
          name?: string;
          owner_id?: string | null;
          queued_files?: number;
          skipped_files?: number;
          source_root?: string | null;
          status?: string;
          total_bytes?: number;
          total_files?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      indexing_v3_agent_jobs: {
        Row: {
          attempt_count: number;
          created_at: string;
          document_id: string;
          enrichment_status: string;
          id: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          metadata: Json;
          next_run_at: string | null;
          status: string;
          updated_at: string;
          version: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          document_id: string;
          enrichment_status?: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          metadata?: Json;
          next_run_at?: string | null;
          status?: string;
          updated_at?: string;
          version?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          document_id?: string;
          enrichment_status?: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          metadata?: Json;
          next_run_at?: string | null;
          status?: string;
          updated_at?: string;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "indexing_v3_agent_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "indexing_v3_agent_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      ingestion_job_stages: {
        Row: {
          artifact_counts: Json;
          created_at: string;
          document_id: string;
          error_class: string | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          metadata: Json;
          retry_count: number;
          stage_name: string;
          stage_status: string;
          started_at: string;
        };
        Insert: {
          artifact_counts?: Json;
          created_at?: string;
          document_id: string;
          error_class?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          metadata?: Json;
          retry_count?: number;
          stage_name: string;
          stage_status?: string;
          started_at?: string;
        };
        Update: {
          artifact_counts?: Json;
          created_at?: string;
          document_id?: string;
          error_class?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          metadata?: Json;
          retry_count?: number;
          stage_name?: string;
          stage_status?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ingestion_job_stages_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "ingestion_job_stages_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      ingestion_jobs: {
        Row: {
          attempt_count: number;
          batch_id: string | null;
          completed_at: string | null;
          created_at: string;
          document_id: string;
          error_message: string | null;
          id: string;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          next_run_at: string;
          progress: number;
          stage: string;
          started_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          batch_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          document_id: string;
          error_message?: string | null;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          next_run_at?: string;
          progress?: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          batch_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          document_id?: string;
          error_message?: string | null;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          next_run_at?: string;
          progress?: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingestion_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "ingestion_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_records: {
        Row: {
          accent: string | null;
          category: string | null;
          class: string | null;
          created_at: string;
          id: string;
          last_reviewed_at: string | null;
          name: string;
          owner_id: string;
          quick: Json;
          review_due_at: string | null;
          schedule: string | null;
          sections: Json;
          slug: string;
          source_status: string;
          stats: Json;
          subclass: string | null;
          tag: string | null;
          updated_at: string;
          validation_status: string;
        };
        Insert: {
          accent?: string | null;
          category?: string | null;
          class?: string | null;
          created_at?: string;
          id?: string;
          last_reviewed_at?: string | null;
          name: string;
          owner_id: string;
          quick?: Json;
          review_due_at?: string | null;
          schedule?: string | null;
          sections?: Json;
          slug: string;
          source_status?: string;
          stats?: Json;
          subclass?: string | null;
          tag?: string | null;
          updated_at?: string;
          validation_status?: string;
        };
        Update: {
          accent?: string | null;
          category?: string | null;
          class?: string | null;
          created_at?: string;
          id?: string;
          last_reviewed_at?: string | null;
          name?: string;
          owner_id?: string;
          quick?: Json;
          review_due_at?: string | null;
          schedule?: string | null;
          sections?: Json;
          slug?: string;
          source_status?: string;
          stats?: Json;
          subclass?: string | null;
          tag?: string | null;
          updated_at?: string;
          validation_status?: string;
        };
        Relationships: [];
      };
      on_call_entries: {
        Row: {
          body: string | null;
          created_at: string;
          details: Json;
          id: string;
          include_on_card: boolean;
          is_personal: boolean;
          last_verified_at: string | null;
          linked_document_ids: string[];
          owner_id: string;
          section: string;
          slug: string;
          sort_order: number;
          subtitle: string | null;
          tags: string[];
          title: string;
          updated_at: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          include_on_card?: boolean;
          is_personal?: boolean;
          last_verified_at?: string | null;
          linked_document_ids?: string[];
          owner_id: string;
          section: string;
          slug: string;
          sort_order?: number;
          subtitle?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          include_on_card?: boolean;
          is_personal?: boolean;
          last_verified_at?: string | null;
          linked_document_ids?: string[];
          owner_id?: string;
          section?: string;
          slug?: string;
          sort_order?: number;
          subtitle?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      calendar_feed_tokens: {
        Row: {
          created_at: string;
          last_used_at: string | null;
          owner_id: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          last_used_at?: string | null;
          owner_id: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          last_used_at?: string | null;
          owner_id?: string;
          token_hash?: string;
        };
        Relationships: [];
      };
      cme_training_periods: {
        Row: {
          created_at: string;
          ends_on: string | null;
          fte: number;
          id: string;
          kind: "stage" | "rotation" | "break";
          label: string;
          owner_id: string;
          starts_on: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_on?: string | null;
          fte?: number;
          id?: string;
          kind: "stage" | "rotation" | "break";
          label: string;
          owner_id: string;
          starts_on: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string | null;
          fte?: number;
          id?: string;
          kind?: "stage" | "rotation" | "break";
          label?: string;
          owner_id?: string;
          starts_on?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cme_training_milestones: {
        Row: {
          completed_on: string | null;
          created_at: string;
          due_fte_months: number | null;
          due_kind: "fte-months" | "date";
          due_on: string | null;
          id: string;
          label: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          completed_on?: string | null;
          created_at?: string;
          due_fte_months?: number | null;
          due_kind: "fte-months" | "date";
          due_on?: string | null;
          id?: string;
          label: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          completed_on?: string | null;
          created_at?: string;
          due_fte_months?: number | null;
          due_kind?: "fte-months" | "date";
          due_on?: string | null;
          id?: string;
          label?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cme_missed_sessions: {
        Row: {
          created_at: string;
          id: string;
          kind: "teaching" | "supervision";
          minutes_lost: number;
          occurred_on: string;
          owner_id: string;
          reason: string | null;
          replacement_entry_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: "teaching" | "supervision";
          minutes_lost: number;
          occurred_on: string;
          owner_id: string;
          reason?: string | null;
          replacement_entry_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: "teaching" | "supervision";
          minutes_lost?: number;
          occurred_on?: string;
          owner_id?: string;
          reason?: string | null;
          replacement_entry_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [{
          foreignKeyName: "cme_missed_sessions_replacement_owner_fk";
          columns: ["replacement_entry_id", "owner_id"];
          isOneToOne: false;
          referencedRelation: "cme_entries";
          referencedColumns: ["id", "owner_id"];
        }];
      };
      cme_entry_drafts: {
        Row: {
          created_at: string;
          follow_up_on: string | null;
          id: string;
          owner_id: string;
          payload: Json;
          updated_at: string;
          waiting_note: string | null;
          waiting_on: "supervisor" | "workforce" | null;
        };
        Insert: {
          created_at?: string;
          follow_up_on?: string | null;
          id?: string;
          owner_id: string;
          payload: Json;
          updated_at?: string;
          waiting_note?: string | null;
          waiting_on?: "supervisor" | "workforce" | null;
        };
        Update: {
          created_at?: string;
          follow_up_on?: string | null;
          id?: string;
          owner_id?: string;
          payload?: Json;
          updated_at?: string;
          waiting_note?: string | null;
          waiting_on?: "supervisor" | "workforce" | null;
        };
        Relationships: [];
      };
      on_call_shifts: {
        Row: {
          created_at: string;
          ends_at: string;
          id: string;
          kind: string | null;
          location: string | null;
          owner_id: string;
          series_id: string | null;
          source: string;
          source_uid: string | null;
          starts_at: string;
          title: string;
          updated_at: string;
          workplace: string | null;
        };
        Insert: {
          created_at?: string;
          ends_at: string;
          id?: string;
          kind?: string | null;
          location?: string | null;
          owner_id: string;
          series_id?: string | null;
          source?: string;
          source_uid?: string | null;
          starts_at: string;
          title: string;
          updated_at?: string;
          workplace?: string | null;
        };
        Update: {
          created_at?: string;
          ends_at?: string;
          id?: string;
          kind?: string | null;
          location?: string | null;
          owner_id?: string;
          series_id?: string | null;
          source?: string;
          source_uid?: string | null;
          starts_at?: string;
          title?: string;
          updated_at?: string;
          workplace?: string | null;
        };
        Relationships: [];
      };
      on_call_shift_imports: {
        Row: {
          added: number;
          changed: number;
          changes: Json;
          file_name: string | null;
          format: string;
          id: string;
          imported_at: string;
          owner_id: string;
          removed: number;
          seen_at: string | null;
          window_end: string;
          window_start: string;
          workplace: string | null;
        };
        Insert: {
          added?: number;
          changed?: number;
          changes?: Json;
          file_name?: string | null;
          format: string;
          id?: string;
          imported_at?: string;
          owner_id: string;
          removed?: number;
          seen_at?: string | null;
          window_end: string;
          window_start: string;
          workplace?: string | null;
        };
        Update: {
          added?: number;
          changed?: number;
          changes?: Json;
          file_name?: string | null;
          format?: string;
          id?: string;
          imported_at?: string;
          owner_id?: string;
          removed?: number;
          seen_at?: string | null;
          window_end?: string;
          window_start?: string;
          workplace?: string | null;
        };
        Relationships: [];
      };
      cme_plan_goals: {
        Row: {
          created_at: string;
          goal: string;
          id: string;
          owner_id: string;
          sort_order: number;
          updated_at: string;
          year_id: string;
        };
        Insert: {
          created_at?: string;
          goal: string;
          id?: string;
          owner_id: string;
          sort_order?: number;
          updated_at?: string;
          year_id: string;
        };
        Update: {
          created_at?: string;
          goal?: string;
          id?: string;
          owner_id?: string;
          sort_order?: number;
          updated_at?: string;
          year_id?: string;
        };
        Relationships: [{
          foreignKeyName: "cme_plan_goals_year_owner_fk";
          columns: ["year_id", "owner_id"];
          isOneToOne: false;
          referencedRelation: "cme_years";
          referencedColumns: ["id", "owner_id"];
        }];
      };
      cme_plan_goal_carries: {
        Row: { created_at: string; owner_id: string; source_goal_id: string; target_goal_id: string | null };
        Insert: { created_at?: string; owner_id: string; source_goal_id: string; target_goal_id?: string | null };
        Update: { created_at?: string; owner_id?: string; source_goal_id?: string; target_goal_id?: string | null };
        Relationships: [
          {
            foreignKeyName: "cme_plan_goal_carries_source_owner_fk";
            columns: ["source_goal_id", "owner_id"];
            isOneToOne: true;
            referencedRelation: "cme_plan_goals";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "cme_plan_goal_carries_target_owner_fk";
            columns: ["target_goal_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "cme_plan_goals";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      cme_entry_goals: {
        Row: {
          created_at: string;
          entry_id: string;
          goal_id: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          entry_id: string;
          goal_id: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          goal_id?: string;
          owner_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cme_entry_goals_entry_owner_fk";
            columns: ["entry_id", "owner_id"];
            isOneToOne: true;
            referencedRelation: "cme_entries";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "cme_entry_goals_goal_owner_fk";
            columns: ["goal_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "cme_plan_goals";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      cme_allocations: {
        Row: {
          category: string;
          entry_id: string;
          hours: number;
          id: string;
          owner_id: string;
        };
        Insert: {
          category: string;
          entry_id: string;
          hours: number;
          id?: string;
          owner_id: string;
        };
        Update: {
          category?: string;
          entry_id?: string;
          hours?: number;
          id?: string;
          owner_id?: string;
        };
        Relationships: [{
          foreignKeyName: "cme_allocations_entry_owner_fk";
          columns: ["entry_id", "owner_id"];
          isOneToOne: false;
          referencedRelation: "cme_entries";
          referencedColumns: ["id", "owner_id"];
        }];
      };
      cme_entries: {
        Row: {
          archived_at: string | null;
          source_url: string | null;
          formal_peer_review_hours: number;
          request_id: string | null;
          request_payload: Json | null;
          activity_date: string;
          buckets: string[];
          cost_cents: number | null;
          created_at: string;
          document_id: string | null;
          id: string;
          owner_id: string;
          reflection: string;
          routine_id: string | null;
          title: string;
          transcribed_at: string | null;
          updated_at: string;
          year_id: string;
        };
        Insert: {
          archived_at?: string | null;
          source_url?: string | null;
          formal_peer_review_hours?: number;
          request_id?: string | null;
          request_payload?: Json | null;
          activity_date: string;
          buckets?: string[];
          cost_cents?: number | null;
          created_at?: string;
          document_id?: string | null;
          id?: string;
          owner_id: string;
          reflection?: string;
          routine_id?: string | null;
          title: string;
          transcribed_at?: string | null;
          updated_at?: string;
          year_id: string;
        };
        Update: {
          archived_at?: string | null;
          source_url?: string | null;
          formal_peer_review_hours?: number;
          request_id?: string | null;
          request_payload?: Json | null;
          activity_date?: string;
          buckets?: string[];
          cost_cents?: number | null;
          created_at?: string;
          document_id?: string | null;
          id?: string;
          owner_id?: string;
          reflection?: string;
          routine_id?: string | null;
          title?: string;
          transcribed_at?: string | null;
          updated_at?: string;
          year_id?: string;
        };
        Relationships: [];
      };
      cme_requirements: {
        Row: {
          completed_on: string | null;
          created_at: string;
          id: string;
          label: string;
          owner_id: string;
          sort_order: number;
          source: string;
          spec: Json;
          year_id: string;
        };
        Insert: {
          completed_on?: string | null;
          created_at?: string;
          id?: string;
          label: string;
          owner_id: string;
          sort_order?: number;
          source: string;
          spec: Json;
          year_id: string;
        };
        Update: {
          completed_on?: string | null;
          created_at?: string;
          id?: string;
          label?: string;
          owner_id?: string;
          sort_order?: number;
          source?: string;
          spec?: Json;
          year_id?: string;
        };
        Relationships: [];
      };
      cme_routines: {
        Row: {
          archived_at: string | null;
          cadence: string;
          created_at: string;
          id: string;
          next_due: string | null;
          owner_id: string;
          title: string;
          usual_allocations: Json;
          usual_hours: number;
        };
        Insert: {
          archived_at?: string | null;
          cadence: string;
          created_at?: string;
          id?: string;
          next_due?: string | null;
          owner_id: string;
          title: string;
          usual_allocations?: Json;
          usual_hours: number;
        };
        Update: {
          archived_at?: string | null;
          cadence?: string;
          created_at?: string;
          id?: string;
          next_due?: string | null;
          owner_id?: string;
          title?: string;
          usual_allocations?: Json;
          usual_hours?: number;
        };
        Relationships: [];
      };
      cme_year_amendments: {
        Row: {
          after: Json;
          amended_at: string;
          before: Json;
          entry_id: string;
          id: string;
          owner_id: string;
          reason: string;
          year_id: string;
        };
        Insert: {
          after: Json;
          amended_at?: string;
          before: Json;
          entry_id: string;
          id?: string;
          owner_id: string;
          reason: string;
          year_id: string;
        };
        Update: {
          after?: Json;
          amended_at?: string;
          before?: Json;
          entry_id?: string;
          id?: string;
          owner_id?: string;
          reason?: string;
          year_id?: string;
        };
        Relationships: [];
      };
      cme_year_snapshots: {
        Row: {
          closed_at: string;
          evaluation: Json;
          id: string;
          owner_id: string;
          record: Json;
          shortfall_note: string | null;
          target_hours: number;
          total_hours: number;
          year_id: string;
        };
        Insert: {
          closed_at?: string;
          evaluation: Json;
          id?: string;
          owner_id: string;
          record: Json;
          shortfall_note?: string | null;
          target_hours: number;
          total_hours: number;
          year_id: string;
        };
        Update: {
          closed_at?: string;
          evaluation?: Json;
          id?: string;
          owner_id?: string;
          record?: Json;
          shortfall_note?: string | null;
          target_hours?: number;
          total_hours?: number;
          year_id?: string;
        };
        Relationships: [];
      };
      cme_years: {
        Row: {
          closed_at: string | null;
          confirmed_on: string;
          confirmed_source: string;
          created_at: string;
          id: string;
          owner_id: string;
          shortfall_note: string | null;
          total_hours: number;
          updated_at: string;
          year: number;
        };
        Insert: {
          closed_at?: string | null;
          confirmed_on: string;
          confirmed_source: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          shortfall_note?: string | null;
          total_hours: number;
          updated_at?: string;
          year: number;
        };
        Update: {
          closed_at?: string | null;
          confirmed_on?: string;
          confirmed_source?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          shortfall_note?: string | null;
          total_hours?: number;
          updated_at?: string;
          year?: number;
        };
        Relationships: [];
      };
      rag_aliases: {
        Row: {
          alias: string;
          alias_type: string;
          canonical: string;
          created_at: string;
          enabled: boolean;
          id: string;
          metadata: Json;
          owner_id: string | null;
          updated_at: string;
          weight: number;
        };
        Insert: {
          alias: string;
          alias_type: string;
          canonical: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          updated_at?: string;
          weight?: number;
        };
        Update: {
          alias?: string;
          alias_type?: string;
          canonical?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          updated_at?: string;
          weight?: number;
        };
        Relationships: [];
      };
      rag_answer_feedback: {
        Row: {
          answer_hash: string;
          cited_source_ids: string[];
          created_at: string;
          feedback_category: string;
          id: string;
          interaction_id: string;
          model: string | null;
          owner_id: string | null;
          provider_request_ids: string[];
          route: string | null;
          source_ids: string[];
        };
        Insert: {
          answer_hash: string;
          cited_source_ids?: string[];
          created_at?: string;
          feedback_category: string;
          id?: string;
          interaction_id: string;
          model?: string | null;
          owner_id?: string | null;
          provider_request_ids?: string[];
          route?: string | null;
          source_ids?: string[];
        };
        Update: {
          answer_hash?: string;
          cited_source_ids?: string[];
          created_at?: string;
          feedback_category?: string;
          id?: string;
          interaction_id?: string;
          model?: string | null;
          owner_id?: string | null;
          provider_request_ids?: string[];
          route?: string | null;
          source_ids?: string[];
        };
        Relationships: [];
      };
      rag_queries: {
        Row: {
          answer: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          model: string | null;
          owner_id: string | null;
          query: string;
          source_chunk_ids: string[];
        };
        Insert: {
          answer?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          model?: string | null;
          owner_id?: string | null;
          query: string;
          source_chunk_ids?: string[];
        };
        Update: {
          answer?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          model?: string | null;
          owner_id?: string | null;
          query?: string;
          source_chunk_ids?: string[];
        };
        Relationships: [];
      };
      rag_query_misses: {
        Row: {
          candidate_aliases: string[];
          candidate_labels: Json;
          cited_chunk_ids: string[];
          clicked_chunk_id: string | null;
          clicked_document_id: string | null;
          created_at: string;
          expected_chunk_id: string | null;
          expected_document_id: string | null;
          expected_file: string | null;
          id: string;
          metadata: Json;
          miss_reason: string;
          normalized_query: string;
          owner_id: string | null;
          promoted_at: string | null;
          promoted_eval_case: boolean;
          query: string;
          query_class: string | null;
          retrieval_strategy: string | null;
          review_notes: string | null;
          review_status: string;
          reviewed_at: string | null;
          route: string | null;
          top_chunk_ids: string[];
          top_files: string[];
          top_score: number | null;
        };
        Insert: {
          candidate_aliases?: string[];
          candidate_labels?: Json;
          cited_chunk_ids?: string[];
          clicked_chunk_id?: string | null;
          clicked_document_id?: string | null;
          created_at?: string;
          expected_chunk_id?: string | null;
          expected_document_id?: string | null;
          expected_file?: string | null;
          id?: string;
          metadata?: Json;
          miss_reason?: string;
          normalized_query: string;
          owner_id?: string | null;
          promoted_at?: string | null;
          promoted_eval_case?: boolean;
          query: string;
          query_class?: string | null;
          retrieval_strategy?: string | null;
          review_notes?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          route?: string | null;
          top_chunk_ids?: string[];
          top_files?: string[];
          top_score?: number | null;
        };
        Update: {
          candidate_aliases?: string[];
          candidate_labels?: Json;
          cited_chunk_ids?: string[];
          clicked_chunk_id?: string | null;
          clicked_document_id?: string | null;
          created_at?: string;
          expected_chunk_id?: string | null;
          expected_document_id?: string | null;
          expected_file?: string | null;
          id?: string;
          metadata?: Json;
          miss_reason?: string;
          normalized_query?: string;
          owner_id?: string | null;
          promoted_at?: string | null;
          promoted_eval_case?: boolean;
          query?: string;
          query_class?: string | null;
          retrieval_strategy?: string | null;
          review_notes?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          route?: string | null;
          top_chunk_ids?: string[];
          top_files?: string[];
          top_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "rag_query_misses_expected_chunk_id_fkey";
            columns: ["expected_chunk_id"];
            isOneToOne: false;
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rag_query_misses_expected_document_id_fkey";
            columns: ["expected_document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "rag_query_misses_expected_document_id_fkey";
            columns: ["expected_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      rag_response_cache: {
        Row: {
          cache_kind: string;
          created_at: string;
          dependency_version: string;
          expires_at: string;
          id: string;
          indexing_version: string;
          normalized_query: string;
          owner_id: string | null;
          payload: Json;
          scope_key: string;
          updated_at: string;
        };
        Insert: {
          cache_kind: string;
          created_at?: string;
          dependency_version?: string;
          expires_at: string;
          id?: string;
          indexing_version?: string;
          normalized_query: string;
          owner_id?: string | null;
          payload: Json;
          scope_key: string;
          updated_at?: string;
        };
        Update: {
          cache_kind?: string;
          created_at?: string;
          dependency_version?: string;
          expires_at?: string;
          id?: string;
          indexing_version?: string;
          normalized_query?: string;
          owner_id?: string | null;
          payload?: Json;
          scope_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rag_retrieval_logs: {
        Row: {
          candidate_count: number;
          created_at: string;
          embedding_cache_hit: boolean | null;
          embedding_field_count: number | null;
          embedding_latency_ms: number | null;
          id: string;
          index_unit_count: number | null;
          is_miss: boolean;
          mean_hybrid_score: number | null;
          memory_card_count: number | null;
          metadata: Json;
          miss_reason: string | null;
          normalized_query: string | null;
          owner_id: string | null;
          query: string;
          query_class: string | null;
          rerank_latency_ms: number | null;
          retrieval_strategy: string | null;
          rpc_latency_ms: number | null;
          selected_chunk_ids: string[];
          selected_count: number;
          selected_document_ids: string[];
          text_candidate_count: number | null;
          top_hybrid_score: number | null;
          top_rrf_score: number | null;
          top_similarity: number | null;
          top_text_rank: number | null;
          total_latency_ms: number | null;
          vector_candidate_count: number | null;
        };
        Insert: {
          candidate_count?: number;
          created_at?: string;
          embedding_cache_hit?: boolean | null;
          embedding_field_count?: number | null;
          embedding_latency_ms?: number | null;
          id?: string;
          index_unit_count?: number | null;
          is_miss?: boolean;
          mean_hybrid_score?: number | null;
          memory_card_count?: number | null;
          metadata?: Json;
          miss_reason?: string | null;
          normalized_query?: string | null;
          owner_id?: string | null;
          query: string;
          query_class?: string | null;
          rerank_latency_ms?: number | null;
          retrieval_strategy?: string | null;
          rpc_latency_ms?: number | null;
          selected_chunk_ids?: string[];
          selected_count?: number;
          selected_document_ids?: string[];
          text_candidate_count?: number | null;
          top_hybrid_score?: number | null;
          top_rrf_score?: number | null;
          top_similarity?: number | null;
          top_text_rank?: number | null;
          total_latency_ms?: number | null;
          vector_candidate_count?: number | null;
        };
        Update: {
          candidate_count?: number;
          created_at?: string;
          embedding_cache_hit?: boolean | null;
          embedding_field_count?: number | null;
          embedding_latency_ms?: number | null;
          id?: string;
          index_unit_count?: number | null;
          is_miss?: boolean;
          mean_hybrid_score?: number | null;
          memory_card_count?: number | null;
          metadata?: Json;
          miss_reason?: string | null;
          normalized_query?: string | null;
          owner_id?: string | null;
          query?: string;
          query_class?: string | null;
          rerank_latency_ms?: number | null;
          retrieval_strategy?: string | null;
          rpc_latency_ms?: number | null;
          selected_chunk_ids?: string[];
          selected_count?: number;
          selected_document_ids?: string[];
          text_candidate_count?: number | null;
          top_hybrid_score?: number | null;
          top_rrf_score?: number | null;
          top_similarity?: number | null;
          top_text_rank?: number | null;
          total_latency_ms?: number | null;
          vector_candidate_count?: number | null;
        };
        Relationships: [];
      };
      rag_visual_eval_cases: {
        Row: {
          active: boolean;
          case_name: string;
          created_at: string;
          document_id: string | null;
          expected_image_type: string | null;
          expected_terms: string[];
          expected_unit_types: string[];
          id: string;
          metadata: Json;
          owner_id: string | null;
          query: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          case_name: string;
          created_at?: string;
          document_id?: string | null;
          expected_image_type?: string | null;
          expected_terms?: string[];
          expected_unit_types?: string[];
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          query: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          case_name?: string;
          created_at?: string;
          document_id?: string | null;
          expected_image_type?: string | null;
          expected_terms?: string[];
          expected_unit_types?: string[];
          id?: string;
          metadata?: Json;
          owner_id?: string | null;
          query?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rag_visual_eval_cases_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "rag_visual_eval_cases_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      rag_visual_eval_runs: {
        Row: {
          case_id: string;
          created_at: string;
          document_id: string | null;
          hit_payload: Json;
          id: string;
          matched_count: number;
          passed: boolean;
          run_metadata: Json;
          top_hit: boolean;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          document_id?: string | null;
          hit_payload?: Json;
          id?: string;
          matched_count?: number;
          passed: boolean;
          run_metadata?: Json;
          top_hit: boolean;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          document_id?: string | null;
          hit_payload?: Json;
          id?: string;
          matched_count?: number;
          passed?: boolean;
          run_metadata?: Json;
          top_hit?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "rag_visual_eval_runs_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "rag_visual_eval_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rag_visual_eval_runs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "document_strict_gate_status";
            referencedColumns: ["document_id"];
          },
          {
            foreignKeyName: "rag_visual_eval_runs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      source_review_events: {
        Row: {
          created_at: string;
          decision: string;
          document_id: string;
          evidence_references: string[];
          id: string;
          new_document_status: string;
          new_validation_status: string;
          policy_version: string | null;
          prior_document_status: string;
          prior_validation_status: string;
          reason: string;
          replacement_document_id: string | null;
          review_date: string | null;
          reviewer_qualification: string | null;
          reviewer_id: string;
        };
        Insert: {
          created_at?: string;
          decision: string;
          document_id: string;
          evidence_references?: string[];
          id?: string;
          new_document_status: string;
          new_validation_status: string;
          policy_version?: string | null;
          prior_document_status: string;
          prior_validation_status: string;
          reason: string;
          replacement_document_id?: string | null;
          review_date?: string | null;
          reviewer_qualification?: string | null;
          reviewer_id: string;
        };
        Update: {
          created_at?: string;
          decision?: string;
          document_id?: string;
          evidence_references?: string[];
          id?: string;
          new_document_status?: string;
          new_validation_status?: string;
          policy_version?: string | null;
          prior_document_status?: string;
          prior_validation_status?: string;
          reason?: string;
          replacement_document_id?: string | null;
          review_date?: string | null;
          reviewer_qualification?: string | null;
          reviewer_id?: string;
        };
        Relationships: [];
      };
      storage_cleanup_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          document_bucket: string;
          document_id: string | null;
          document_paths: string[];
          document_title: string | null;
          id: string;
          image_bucket: string;
          image_paths: string[];
          last_error: string | null;
          metadata: Json;
          owner_id: string | null;
          public_source_cleanup_not_before: string | null;
          public_source_claim_expires_at: string | null;
          public_source_claim_token: string | null;
          public_source_reservation_id: string | null;
          public_source_upload_attempt_id: string | null;
          public_source_storage_bucket: string | null;
          public_source_storage_path: string | null;
          status: string;
          storage_removed: number;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          document_bucket?: string;
          document_id?: string | null;
          document_paths?: string[];
          document_title?: string | null;
          id?: string;
          image_bucket?: string;
          image_paths?: string[];
          last_error?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          public_source_cleanup_not_before?: string | null;
          public_source_claim_expires_at?: string | null;
          public_source_claim_token?: string | null;
          public_source_reservation_id?: string | null;
          public_source_upload_attempt_id?: string | null;
          public_source_storage_bucket?: string | null;
          public_source_storage_path?: string | null;
          status?: string;
          storage_removed?: number;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          document_bucket?: string;
          document_id?: string | null;
          document_paths?: string[];
          document_title?: string | null;
          id?: string;
          image_bucket?: string;
          image_paths?: string[];
          last_error?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          public_source_cleanup_not_before?: string | null;
          public_source_claim_expires_at?: string | null;
          public_source_claim_token?: string | null;
          public_source_reservation_id?: string | null;
          public_source_upload_attempt_id?: string | null;
          public_source_storage_bucket?: string | null;
          public_source_storage_path?: string | null;
          status?: string;
          storage_removed?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storage_cleanup_jobs_public_source_reservation_id_fkey";
            columns: ["public_source_reservation_id"];
            isOneToOne: false;
            referencedRelation: "public_source_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "storage_cleanup_jobs_public_source_upload_attempt_id_fkey";
            columns: ["public_source_upload_attempt_id"];
            isOneToOne: true;
            referencedRelation: "public_source_upload_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      user_favourite_sets: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_favourites: {
        Row: {
          content_key: string;
          content_type: string;
          created_at: string;
          last_opened_at: string | null;
          pinned_at: string | null;
          set_id: string | null;
          sort_order: number;
          user_id: string;
        };
        Insert: {
          content_key: string;
          content_type: string;
          created_at?: string;
          last_opened_at?: string | null;
          pinned_at?: string | null;
          set_id?: string | null;
          sort_order?: number;
          user_id: string;
        };
        Update: {
          content_key?: string;
          content_type?: string;
          created_at?: string;
          last_opened_at?: string | null;
          pinned_at?: string | null;
          set_id?: string | null;
          sort_order?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_favourites_owner_set_fkey";
            columns: ["user_id", "set_id"];
            isOneToOne: false;
            referencedRelation: "user_favourite_sets";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      user_preferences: {
        Row: {
          preferences: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          preferences?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          preferences?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      site_content_publications: GeneratedTable<{
        id: string; logical_id: string; kind: string; slug: string; source_table: string; source_row_id: string;
        source_owner_id: string; source_version: string; published_by: string; administrator_authorized_at: string;
        administrator_authorization_version: string; reconciliation_plan_digest: string | null;
        record: Json; render_payload: Json; retired: boolean; created_at: string;
      }, "logical_id" | "kind" | "slug" | "source_table" | "source_row_id" | "source_owner_id" | "source_version" | "published_by" | "administrator_authorized_at" | "administrator_authorization_version" | "record" | "render_payload">;
      site_content_reconciliation_plans: GeneratedTable<{
        plan_digest: string; version: string; trusted_snapshot_digest: string; trusted_snapshots: Json; dispositions: Json;
        expected_record_count: number; expected_group_count: number; batch_size: number; batch_count: number; counts: Json;
        reviewed_by: string; reviewed_at: string; administrator_authorized_at: string;
        administrator_authorization_version: string;
      }, "plan_digest" | "version" | "trusted_snapshot_digest" | "trusted_snapshots" | "dispositions" | "expected_record_count" | "expected_group_count" | "batch_size" | "batch_count" | "counts" | "reviewed_by" | "administrator_authorized_at" | "administrator_authorization_version">;
      site_content_public_records: GeneratedTable<{
        logical_id: string; kind: string; slug: string; current_publication_id: string; head_change_epoch: number;
        retired: boolean; pending_event_sequence: number | null; updated_at: string;
      }, "logical_id" | "kind" | "slug" | "current_publication_id" | "head_change_epoch">;
      site_content_sync_state: GeneratedTable<{
        singleton: boolean; change_epoch: number; served_change_epoch: number; active_release_id: string | null;
        active_release_digest: string | null; active_transition_receipt_id: string | null;
        initialized: boolean; updated_at: string;
      }>;
      site_content_sync_events: GeneratedTable<{
        event_sequence: number; logical_id: string; target_publication_id: string; target_change_epoch: number; state: string;
        attempt_count: number; next_attempt_at: string; worker_id: string | null; lease_token: string | null;
        lease_generation: number; lease_expires_at: string | null; superseded_by_event_sequence: number | null;
        terminal_at: string | null; last_error_code: string | null; created_at: string; updated_at: string;
      }, "logical_id" | "target_publication_id" | "target_change_epoch">;
      site_content_sync_worker_invocations: GeneratedTable<{
        invocation_id: string; worker_id: string; started_at: string; admission_expires_at: string;
        terminal_phase: string | null; terminal_at: string | null; outcome_code: string | null;
      }, "invocation_id" | "worker_id" | "admission_expires_at">;
      site_content_sync_event_plans: GeneratedTable<{
        event_sequence: number; plan_digest: string; target_change_epoch: number; plan: Json; release_id: string;
        created_at: string;
      }, "event_sequence" | "plan_digest" | "target_change_epoch" | "plan" | "release_id">;
      site_content_releases: GeneratedTable<{
        id: string; state: string; target_change_epoch: number; previous_release_id: string | null; registry_version: string;
        static_manifest_digest: string; dynamic_state_digest: string; release_digest: string; generation_id: string;
        plan_digest: string; reconciliation_plan_digest: string | null; expected_added_count: number;
        expected_changed_count: number; expected_unchanged_count: number; expected_record_count: number;
        expected_tombstone_count: number; must_pass_checks: boolean; created_at: string; activated_at: string | null;
      }, "id" | "state" | "target_change_epoch" | "registry_version" | "static_manifest_digest" | "dynamic_state_digest" | "release_digest" | "generation_id" | "plan_digest" | "expected_added_count" | "expected_changed_count" | "expected_unchanged_count" | "expected_record_count" | "expected_tombstone_count">;
      site_content_release_records: GeneratedTable<{
        release_id: string; logical_id: string; target_publication_id: string | null; logical_document_id: string;
        logical_chunk_id: string; normalized_text: string; content_hash: string; publication_fingerprint: string;
        governance_fingerprint: string; lineage_fingerprint: string; public_metadata_fingerprint: string;
        embedding_model: string; embedding_dimensions: number; embedding_fingerprint: string;
        embedding_value_digest: string | null; embedding: Vector | null; record: Json | null; render_payload: Json | null;
        tombstone: boolean; public_visible: boolean; created_at: string;
      }, "release_id" | "logical_id" | "logical_document_id" | "logical_chunk_id" | "normalized_text" | "content_hash" | "publication_fingerprint" | "governance_fingerprint" | "lineage_fingerprint" | "public_metadata_fingerprint" | "embedding_model" | "embedding_dimensions" | "embedding_fingerprint">;
      site_content_release_receipts: GeneratedTable<{
        receipt_id: string; release_id: string; receipt_kind: string; recovery_readiness_digest: string; receipt: Json; created_at: string;
      }, "receipt_id" | "release_id" | "receipt_kind" | "recovery_readiness_digest" | "receipt">;
      admin_leave_balances: {
        Row: {
          amount: number;
          as_of: string;
          created_at: string;
          id: string;
          kind: string;
          owner_id: string;
          source_note: string | null;
          unit: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          as_of: string;
          created_at?: string;
          id?: string;
          kind: string;
          owner_id: string;
          source_note?: string | null;
          unit: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          as_of?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          owner_id?: string;
          source_note?: string | null;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_settings: {
        Row: {
          after_shift_asked_until: string | null;
          after_shift_prompt: boolean;
          created_at: string;
          level: string | null;
          owner_id: string;
          pay_fortnight_start: string | null;
          updated_at: string;
        };
        Insert: {
          after_shift_asked_until?: string | null;
          after_shift_prompt?: boolean;
          created_at?: string;
          level?: string | null;
          owner_id: string;
          pay_fortnight_start?: string | null;
          updated_at?: string;
        };
        Update: {
          after_shift_asked_until?: string | null;
          after_shift_prompt?: boolean;
          created_at?: string;
          level?: string | null;
          owner_id?: string;
          pay_fortnight_start?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      extra_time_records: {
        Row: {
          claim_paid_on: string | null;
          claim_reference: string | null;
          claim_sent_on: string | null;
          claim_status: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          kind: string;
          owner_id: string;
          reason: string | null;
          started_at: string;
          updated_at: string;
        };
        Insert: {
          claim_paid_on?: string | null;
          claim_reference?: string | null;
          claim_sent_on?: string | null;
          claim_status?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          kind: string;
          owner_id: string;
          reason?: string | null;
          started_at: string;
          updated_at?: string;
        };
        Update: {
          claim_paid_on?: string | null;
          claim_reference?: string | null;
          claim_sent_on?: string | null;
          claim_status?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          kind?: string;
          owner_id?: string;
          reason?: string | null;
          started_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      on_call_service_member_events: {
        Row: {
          actor_id: string | null;
          at: string;
          event: string;
          id: number;
          mode: string | null;
          service_id: string;
          user_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          at?: string;
          event: string;
          id?: number;
          mode?: string | null;
          service_id: string;
          user_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          at?: string;
          event?: string;
          id?: number;
          mode?: string | null;
          service_id?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      roster_assignments: {
        Row: {
          ends_at: string;
          grade: string | null;
          id: string;
          kind: string;
          publication_id: string;
          roster_name: string | null;
          service_id: string;
          shift_code: string;
          site_id: string | null;
          starts_at: string;
          superseded_at: string | null;
          user_id: string | null;
        };
        Insert: {
          ends_at: string;
          grade?: string | null;
          id?: string;
          kind: string;
          publication_id: string;
          roster_name?: string | null;
          service_id: string;
          shift_code: string;
          site_id?: string | null;
          starts_at: string;
          superseded_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          ends_at?: string;
          grade?: string | null;
          id?: string;
          kind?: string;
          publication_id?: string;
          roster_name?: string | null;
          service_id?: string;
          shift_code?: string;
          site_id?: string | null;
          starts_at?: string;
          superseded_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      roster_calendar_links: {
        Row: {
          created_at: string;
          id: string;
          last_error: string | null;
          last_fetched_at: string | null;
          owner_id: string;
          updated_at: string;
          url: string;
          workplace: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_error?: string | null;
          last_fetched_at?: string | null;
          owner_id: string;
          updated_at?: string;
          url: string;
          workplace?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_error?: string | null;
          last_fetched_at?: string | null;
          owner_id?: string;
          updated_at?: string;
          url?: string;
          workplace?: string | null;
        };
        Relationships: [];
      };
      roster_change_agreements: {
        Row: {
          agreed_at: string;
          change_id: number;
          user_id: string;
        };
        Insert: {
          agreed_at?: string;
          change_id: number;
          user_id: string;
        };
        Update: {
          agreed_at?: string;
          change_id?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      roster_changes: {
        Row: {
          actor_id: string | null;
          agreement_required: boolean;
          at: string;
          change: Json;
          draft_id: string | null;
          id: number;
          service_id: string;
          source: string;
          target: string;
          undo: Json | null;
          undone_at: string | null;
          undone_by: string | null;
        };
        Insert: {
          actor_id?: string | null;
          agreement_required?: boolean;
          at?: string;
          change: Json;
          draft_id?: string | null;
          id?: number;
          service_id: string;
          source: string;
          target: string;
          undo?: Json | null;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Update: {
          actor_id?: string | null;
          agreement_required?: boolean;
          at?: string;
          change?: Json;
          draft_id?: string | null;
          id?: number;
          service_id?: string;
          source?: string;
          target?: string;
          undo?: Json | null;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Relationships: [];
      };
      roster_draft_assignments: {
        Row: {
          draft_id: string;
          ends_at: string;
          grade: string | null;
          id: string;
          kind: string;
          roster_name: string | null;
          shift_code: string;
          site_id: string | null;
          starts_at: string;
          user_id: string | null;
        };
        Insert: {
          draft_id: string;
          ends_at: string;
          grade?: string | null;
          id?: string;
          kind: string;
          roster_name?: string | null;
          shift_code: string;
          site_id?: string | null;
          starts_at: string;
          user_id?: string | null;
        };
        Update: {
          draft_id?: string;
          ends_at?: string;
          grade?: string | null;
          id?: string;
          kind?: string;
          roster_name?: string | null;
          shift_code?: string;
          site_id?: string | null;
          starts_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      roster_drafts: {
        Row: {
          based_on_publication_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          period_end: string;
          period_start: string;
          service_id: string;
          updated_at: string;
        };
        Insert: {
          based_on_publication_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          period_end: string;
          period_start: string;
          service_id: string;
          updated_at?: string;
        };
        Update: {
          based_on_publication_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          period_end?: string;
          period_start?: string;
          service_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      roster_leave: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          kind: string;
          owner_id: string;
          service_id: string | null;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          kind: string;
          owner_id: string;
          service_id?: string | null;
          starts_on: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          kind?: string;
          owner_id?: string;
          service_id?: string | null;
          starts_on?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      roster_member_roles: {
        Row: {
          grade: string | null;
          granted_at: string;
          granted_by: string | null;
          revoked_at: string | null;
          role: string;
          roster_name: string | null;
          rotation_ends_on: string | null;
          service_id: string;
          user_id: string;
        };
        Insert: {
          grade?: string | null;
          granted_at?: string;
          granted_by?: string | null;
          revoked_at?: string | null;
          role?: string;
          roster_name?: string | null;
          rotation_ends_on?: string | null;
          service_id: string;
          user_id: string;
        };
        Update: {
          grade?: string | null;
          granted_at?: string;
          granted_by?: string | null;
          revoked_at?: string | null;
          role?: string;
          roster_name?: string | null;
          rotation_ends_on?: string | null;
          service_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      roster_open_shifts: {
        Row: {
          assignment_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          ends_at: string;
          id: string;
          kind: string;
          min_grade: string | null;
          posted_by: string | null;
          service_id: string;
          shift_code: string;
          site_id: string | null;
          starts_at: string;
          status: string;
          urgent: boolean;
        };
        Insert: {
          assignment_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          ends_at: string;
          id?: string;
          kind: string;
          min_grade?: string | null;
          posted_by?: string | null;
          service_id: string;
          shift_code: string;
          site_id?: string | null;
          starts_at: string;
          status?: string;
          urgent?: boolean;
        };
        Update: {
          assignment_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          ends_at?: string;
          id?: string;
          kind?: string;
          min_grade?: string | null;
          posted_by?: string | null;
          service_id?: string;
          shift_code?: string;
          site_id?: string | null;
          starts_at?: string;
          status?: string;
          urgent?: boolean;
        };
        Relationships: [];
      };
      roster_publication_seen: {
        Row: {
          publication_id: string;
          seen_at: string;
          user_id: string;
        };
        Insert: {
          publication_id: string;
          seen_at?: string;
          user_id: string;
        };
        Update: {
          publication_id?: string;
          seen_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      roster_publications: {
        Row: {
          id: string;
          kind: string;
          period_end: string;
          period_start: string;
          published_at: string;
          published_by: string | null;
          service_id: string;
          source_name: string | null;
          version: number;
        };
        Insert: {
          id?: string;
          kind?: string;
          period_end: string;
          period_start: string;
          published_at?: string;
          published_by?: string | null;
          service_id: string;
          source_name?: string | null;
          version: number;
        };
        Update: {
          id?: string;
          kind?: string;
          period_end?: string;
          period_start?: string;
          published_at?: string;
          published_by?: string | null;
          service_id?: string;
          source_name?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      roster_shift_codes: {
        Row: {
          code: string;
          ends: string | null;
          kind: string;
          label: string | null;
          service_id: string;
          starts: string | null;
        };
        Insert: {
          code: string;
          ends?: string | null;
          kind: string;
          label?: string | null;
          service_id: string;
          starts?: string | null;
        };
        Update: {
          code?: string;
          ends?: string | null;
          kind?: string;
          label?: string | null;
          service_id?: string;
          starts?: string | null;
        };
        Relationships: [];
      };
      roster_staffing_needs: {
        Row: {
          grade: string | null;
          id: string;
          kind: string;
          needed: number;
          on_date: string | null;
          service_id: string;
          site_id: string | null;
          weekday: number | null;
        };
        Insert: {
          grade?: string | null;
          id?: string;
          kind: string;
          needed: number;
          on_date?: string | null;
          service_id: string;
          site_id?: string | null;
          weekday?: number | null;
        };
        Update: {
          grade?: string | null;
          id?: string;
          kind?: string;
          needed?: number;
          on_date?: string | null;
          service_id?: string;
          site_id?: string | null;
          weekday?: number | null;
        };
        Relationships: [];
      };
      roster_swaps: {
        Row: {
          accepted_at: string | null;
          auto_approved: boolean;
          cancel_reason: string | null;
          counterparty_id: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          expires_at: string;
          give_assignment_id: string;
          id: string;
          needs_manager_because: string | null;
          requester_id: string;
          service_id: string;
          status: string;
          take_assignment_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          auto_approved?: boolean;
          cancel_reason?: string | null;
          counterparty_id: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          expires_at: string;
          give_assignment_id: string;
          id?: string;
          needs_manager_because?: string | null;
          requester_id: string;
          service_id: string;
          status?: string;
          take_assignment_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          auto_approved?: boolean;
          cancel_reason?: string | null;
          counterparty_id?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          expires_at?: string;
          give_assignment_id?: string;
          id?: string;
          needs_manager_because?: string | null;
          requester_id?: string;
          service_id?: string;
          status?: string;
          take_assignment_id?: string | null;
        };
        Relationships: [];
      };
      roster_publication_protections: {
        Row: {
          id: string;
          service_id: string;
          swap_id: string | null;
          open_shift_id: string | null;
          give_assignment_id: string;
          take_assignment_id: string | null;
          overridden_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          service_id: string;
          swap_id?: string | null;
          open_shift_id?: string | null;
          give_assignment_id: string;
          take_assignment_id?: string | null;
          overridden_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          service_id?: string;
          swap_id?: string | null;
          open_shift_id?: string | null;
          give_assignment_id?: string;
          take_assignment_id?: string | null;
          overridden_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      roster_team_settings: {
        Row: {
          ai_helper_consented_at: string | null;
          ai_helper_consented_by: string | null;
          next_cutoff_on: string | null;
          pay_fortnight_anchor: string | null;
          rules: Json;
          rules_source: string | null;
          service_id: string;
          swap_approval: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          ai_helper_consented_at?: string | null;
          ai_helper_consented_by?: string | null;
          next_cutoff_on?: string | null;
          pay_fortnight_anchor?: string | null;
          rules?: Json;
          rules_source?: string | null;
          service_id: string;
          swap_approval?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ai_helper_consented_at?: string | null;
          ai_helper_consented_by?: string | null;
          next_cutoff_on?: string | null;
          pay_fortnight_anchor?: string | null;
          rules?: Json;
          rules_source?: string | null;
          service_id?: string;
          swap_approval?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      roster_unavailability: {
        Row: {
          created_at: string;
          kind: string;
          on_date: string;
          service_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          kind: string;
          on_date: string;
          service_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          kind?: string;
          on_date?: string;
          service_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      web_push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string | null;
          owner_id: string;
          p256dh: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string | null;
          owner_id: string;
          p256dh: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string | null;
          owner_id?: string;
          p256dh?: string;
        };
        Relationships: [];
      };
      alert_reminder_times: GeneratedTable<
        { owner_id: string; ref: string; due_at: string; endpoint: string; created_at: string },
        "owner_id" | "ref" | "due_at" | "endpoint"
      >;
      alert_brief_sent: GeneratedTable<{ owner_id: string; perth_date: string; sent_at: string }, "owner_id" | "perth_date">;
      work_admin_paperwork: GeneratedTable<{ owner_id: string; record: Json | null; updated_at: string }, "owner_id">;
      work_backups: GeneratedTable<
        { owner_id: string; section: string; record: Json | null; updated_at: string },
        "owner_id" | "section"
      >;
      work_booking_courses: GeneratedTable<
        {
          id: string;
          organiser_id: string | null;
          organiser_label: string;
          service_id: string | null;
          kind: string;
          title: string;
          about: string;
          course_date: string;
          start_time: string;
          end_time: string;
          location: string;
          capacity: number;
          closes_on: string | null;
          renewal: string | null;
          waitlist: boolean;
          status: string;
          change_summary: string | null;
          changed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "organiser_label" | "kind" | "title" | "course_date" | "start_time" | "end_time" | "location" | "capacity"
      >;
      work_course_bookings: GeneratedTable<
        {
          id: string;
          course_id: string;
          owner_id: string;
          display_name: string;
          status: string;
          created_at: string;
          updated_at: string;
        },
        "course_id" | "owner_id" | "display_name" | "status"
      >;
    };
    Views: {
      document_strict_gate_status: {
        Row: {
          counts: Json | null;
          document_id: string | null;
          document_status: string | null;
          document_updated_at: string | null;
          enrichment_status: string | null;
          gate_passed: boolean | null;
          generated_labels: number | null;
          index_units: number | null;
          indexing_v3_agent_status: string | null;
          memory_cards: number | null;
          missing: string[] | null;
          owner_id: string | null;
          presence: Json | null;
          quality_extraction_quality: string | null;
          quality_score: number | null;
          sections: number | null;
          summary_embedding: boolean | null;
          title_embedding: boolean | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      calendar_feed_rotate: { Args: { p_owner_id: string; p_token_hash: string }; Returns: undefined };
      calendar_feed_revoke: { Args: { p_owner_id: string }; Returns: undefined };
      calendar_feed_owner: { Args: { p_token_hash: string }; Returns: string | null };
      on_call_shifts_replace: {
        Args: {
          p_owner_id: string;
          p_window_start: string;
          p_window_end: string;
          p_format: string;
          p_shifts: Json;
          p_changes: Json;
          p_added: number;
          p_changed: number;
          p_removed: number;
        };
        Returns: string;
      };
      roster_own_shifts_replace: {
        Args: {
          p_owner_id: string;
          p_window_start: string;
          p_window_end: string;
          p_format: string;
          p_workplace: string | null;
          p_file_name: string | null;
          p_shifts: Json;
          p_changes: Json;
          p_added: number;
          p_changed: number;
          p_removed: number;
        };
        Returns: string;
      };
      roster_read: {
        Args: { p_actor_id: string; p_service_id: string | null; p_what: string; p_payload?: Json };
        Returns: Json;
      };
      roster_command: {
        Args: { p_actor_id: string; p_service_id: string; p_action: string; p_payload?: Json };
        Returns: Json;
      };
      roster_team_members: { Args: { p_actor_id: string; p_service_id: string }; Returns: Json };
      work_bookings_is_site_admin: { Args: { p_user_id: string }; Returns: boolean };
      work_bookings_can_post: { Args: { p_actor_id: string; p_service_id: string | null }; Returns: boolean };
      work_bookings_today: { Args: never; Returns: string };
      work_bookings_promote: { Args: { p_course_id: string }; Returns: number };
      work_bookings_day_words: { Args: { p_day: string }; Returns: string };
      work_bookings_time_words: { Args: { p_start: string; p_end: string }; Returns: string };
      work_bookings_visible: { Args: { p_actor_id: string }; Returns: { id: string; manage: boolean }[] };
      work_bookings_read: { Args: { p_actor_id: string }; Returns: Json };
      work_book_course: { Args: { p_actor_id: string; p_course_id: string }; Returns: Json };
      work_cancel_course_booking: { Args: { p_actor_id: string; p_course_id: string }; Returns: Json };
      work_save_course: {
        Args: {
          p_actor_id: string;
          p_course_id: string | null;
          p_service_id: string | null;
          p_organiser_label: string;
          p_kind: string;
          p_title: string;
          p_about: string;
          p_course_date: string;
          p_start_time: string;
          p_end_time: string;
          p_location: string;
          p_capacity: number;
          p_closes_on: string | null;
          p_renewal: string | null;
          p_waitlist: boolean;
          p_post: boolean;
        };
        Returns: Json;
      };
      work_cancel_course: { Args: { p_actor_id: string; p_course_id: string }; Returns: Json };
      alert_claim_due_reminders: {
        Args: { p_now: string; p_limit: number };
        Returns: { owner_id: string; ref: string; due_at: string; endpoint: string }[];
      };
      alert_claim_morning_brief: { Args: { p_owner_id: string; p_perth_date: string }; Returns: boolean };
      roster_set_cutoff: {
        Args: { p_actor_id: string; p_service_id: string; p_cutoff: string | null };
        Returns: Json;
      };
      roster_publish_preview: {
        Args: { p_actor_id: string; p_service_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      roster_publish: {
        Args: { p_actor_id: string; p_service_id: string; p_expected_token: string; p_payload: Json };
        Returns: Json;
      };
      roster_set_manager: {
        Args: { p_service_id: string; p_user_id: string; p_actor_id: string; p_manager: boolean };
        Returns: Json;
      };
      on_call_service_set_verified: {
        Args: { p_service_id: string; p_actor_id: string; p_verified: boolean; p_is_demo: boolean };
        Returns: Json;
      };
      service_member_active: { Args: { p_service_id: string; p_user_id: string }; Returns: boolean };
      roster_can_invite: { Args: { p_service_id: string; p_user_id: string }; Returns: boolean };
      cme_confirm_year: { Args: { p_owner_id: string; p_set: Json }; Returns: string };
      cme_save_plan_goals: { Args: { p_owner_id: string; p_year_id: string; p_goals: Json }; Returns: Json };
      cme_save_plan_goals_checked: {
        Args: { p_owner_id: string; p_year_id: string; p_goals: Json; p_expected_goals: Json };
        Returns: Json;
      };
      cme_carry_plan_goal: {
        Args: { p_owner_id: string; p_source_year: number; p_goal_id: string };
        Returns: Json;
      };
      cme_set_entry_goal: { Args: { p_owner_id: string; p_entry_id: string; p_goal_id: string | null }; Returns: Json };
      cme_set_entry_archived: { Args: { p_owner_id: string; p_entry_id: string; p_archived: boolean }; Returns: Json };
      cme_evidence_counts: { Args: { p_owner_id: string; p_year: number }; Returns: Json };
      cme_remove_evidence: {
        Args: { p_owner_id: string; p_evidence_id: string; p_reason: string };
        Returns: Database["public"]["Tables"]["cme_evidence"]["Row"];
      };
      cme_guard_evidence_insert: { Args: never; Returns: unknown };
      cme_guard_archived_entry: { Args: never; Returns: unknown };
      on_call_service_command: { Args: { p_actor_id: string; p_service_id: string | null; p_action: string; p_payload: Json }; Returns: Json };
      teaching_command: { Args: { p_actor_id: string; p_service_id: string | null; p_action: string; p_payload: Json }; Returns: Json };
      teaching_depth_command: { Args: { p_actor_id: string; p_service_id: string; p_action: string; p_payload: Json }; Returns: Json };
      teaching_whats_on_command: { Args: { p_actor_id: string; p_service_id: string | null; p_action: string; p_payload: Json }; Returns: Json };
      teaching_platform_command: { Args: { p_platform_actor_id: string; p_service_id: string; p_action: string; p_payload: Json }; Returns: Json };
      teaching_checkin_open: { Args: { p_token: string; p_claim_hash: string }; Returns: Json };
      teaching_display_code: { Args: { p_link_hash: string }; Returns: Json };
      teaching_feed_events: { Args: { p_owner_id: string; p_from: string; p_to: string }; Returns: Json };
      cme_save_teaching_entry: { Args: { p_owner_id: string; p_occurrence_id: string; p_hours: number; p_request_id: string }; Returns: Json };
      cme_close_year: {
        Args: { p_owner_id: string; p_year_id: string; p_evaluation: Json; p_shortfall_note?: string | null };
        Returns: Json;
      };
      cme_amend_closed_entry: {
        Args: { p_owner_id: string; p_entry_id: string; p_entry: Json; p_reason: string };
        Returns: Json;
      };
      cme_save_entry: { Args: { p_owner_id: string; p_year_id: string; p_entry_id: string; p_entry: Json; p_create: boolean; p_request_id?: string | null }; Returns: Json };
      analyze_rag_tables: { Args: never; Returns: undefined };
      assert_public_source_document_governance: {
        Args: {
          p_document_id: string;
        };
        Returns: undefined;
      };
      apply_document_metadata_patch: {
        Args: {
          p_document_id: string;
          p_metadata_patch?: Json;
        };
        Returns: undefined;
      };
      record_source_review: {
        Args: {
          p_decision: string;
          p_document_id: string;
          p_evidence_references?: string[];
          p_reason: string;
          p_replacement_document_id?: string | null;
          p_review_date?: string | null;
          p_reviewer_id: string;
        };
        Returns: Json;
      };
      record_source_review_v2: {
        Args: {
          p_decision: string;
          p_document_id: string;
          p_evidence_references?: string[];
          p_policy_version?: string | null;
          p_reason: string;
          p_replacement_document_id?: string | null;
          p_review_date?: string | null;
          p_reviewer_id: string;
          p_reviewer_qualification?: string | null;
        };
        Returns: Json;
      };
      record_clinical_quality_feedback_triage: {
        Args: {
          p_actor_user_id: string;
          p_owner_role: string;
          p_owner_user_id: string | null;
          p_resolution_code: string | null;
          p_retest_reference: string;
          p_signal_id: string;
          p_signal_type: string;
          p_status: string;
        };
        Returns: Json;
      };
      reorder_user_favourite: {
        Args: {
          p_content_key: string;
          p_content_type: string;
          p_direction: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      purge_expired_rag_response_cache: {
        Args: { p_limit?: number };
        Returns: number;
      };
      consume_api_subject_rate_limit: {
        Args: {
          p_subject_key: string;
          p_bucket: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: {
          limited: boolean;
          limit_value: number;
          remaining: number;
          retry_after_seconds: number;
          reset_at: string;
        }[];
      };
      backfill_legacy_index_health_batch: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      chunk_image_metadata: {
        Args: { chunk_image_ids: string[] };
        Returns: Json;
      };
      claim_indexing_v3_agent_jobs: {
        Args: {
          p_claim_limit?: number;
          p_stale_after_minutes?: number;
          p_worker_id: string;
        };
        Returns: {
          attempt_count: number;
          batch_id: string;
          document_id: string;
          documents: Json;
          error_message: string;
          id: string;
          locked_at: string;
          locked_by: string;
          max_attempts: number;
          progress: number;
          stage: string;
          status: string;
        }[];
      };
      update_indexing_v3_agent_job_status: {
        Args: {
          p_document_id: string;
          p_error?: string | null;
          p_next_run_at?: string | null;
          p_status: string;
        };
        Returns: Json;
      };
      claim_ingestion_jobs: {
        Args: {
          p_claim_limit?: number;
          p_stale_after_minutes?: number;
          p_worker_id: string;
        };
        Returns: {
          attempt_count: number;
          batch_id: string;
          document_id: string;
          documents: Json;
          error_message: string;
          id: string;
          locked_at: string;
          locked_by: string;
          max_attempts: number;
          progress: number;
          stage: string;
          status: string;
        }[];
      };
      cleanup_abandoned_document_index_generations: {
        Args: { p_document_id?: string | null; p_dry_run?: boolean; p_limit?: number };
        Returns: Json;
      };
      commit_document_deep_memory_generation: {
        Args: {
          p_artifact_generation_id: string;
          p_document_id: string;
          p_document_intelligence_version: string;
          p_index_unit_counts_by_type: Json;
          p_memory_card_count: number;
          p_producer: string;
          p_rag_memory_version: string;
          p_repaired_anchor_count?: number;
          p_section_count: number;
        };
        Returns: Json;
      };
      commit_document_index_generation: {
        Args: {
          p_chunk_count?: number;
          p_document_id: string;
          p_image_count?: number;
          p_index_generation_id: string;
          p_metadata?: Json;
          p_page_count?: number;
          p_pages?: Json;
          p_quality?: Json;
          p_status?: string;
        };
        Returns: Json;
      };
      complete_ingestion_job: {
        Args: {
          p_batch_id?: string | null;
          p_document_id: string;
          p_job_id: string;
          p_stage?: string;
        };
        Returns: Json;
      };
      create_uploaded_document_with_ingestion_job: {
        Args: {
          p_document: Json;
          p_max_attempts: number;
        };
        Returns: Json;
      };
      complete_strict_enrichment_job: {
        Args: {
          p_agent_version?: string;
          p_document_id: string;
          p_job_id?: string;
          p_stage?: string;
          p_visual_indexing_version?: string;
        };
        Returns: {
          completed_job_ids: string[];
          counts: Json;
          document_id: string;
          gate_passed: boolean;
          missing: string[];
          ok: boolean;
          presence: Json;
          status: string;
        }[];
      };
      consume_api_rate_limit: {
        Args: {
          p_bucket: string;
          p_limit: number;
          p_owner_id: string;
          p_window_seconds: number;
        };
        Returns: {
          limit_value: number;
          limited: boolean;
          remaining: number;
          reset_at: string;
          retry_after_seconds: number;
        }[];
      };
      consume_anonymous_rate_limits_atomic: {
        Args: {
          p_bucket: string;
          p_ceiling_bucket: string | null;
          p_ceiling_key: string | null;
          p_ceiling_limit: number | null;
          p_ceiling_window_seconds: number | null;
          p_global_key: string;
          p_global_limit: number;
          p_global_window_seconds: number;
          p_subject_key: string;
          p_subject_limit: number;
          p_subject_window_seconds: number;
        };
        Returns: {
          limit_value: number;
          limited: boolean;
          remaining: number;
          reset_at: string;
          retry_after_seconds: number;
          scope: string | null;
        }[];
      };
      consume_summary_rate_limits_atomic: {
        Args: {
          p_answer_limit: number;
          p_answer_window_seconds: number;
          p_global_answer_limit: number;
          p_global_answer_window_seconds: number;
          p_owner_id: string | null;
          p_subject_key: string | null;
          p_summary_limit: number;
          p_summary_window_seconds: number;
        };
        Returns: {
          bucket: string | null;
          limit_value: number;
          limited: boolean;
          remaining: number;
          reset_at: string;
          retry_after_seconds: number;
        }[];
      };
      corpus_topic_term_stats: {
        Args: { terms: string[]; owner_filter?: string | null };
        Returns: {
          term: string;
          has_ts_signal: boolean;
          title_doc_count: number;
          chunk_present: boolean;
          total_doc_count: number;
        }[];
      };
      corpus_topic_term_stats_v2: {
        Args: { terms: string[]; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["corpus_topic_term_stats"]["Returns"];
      };
      correct_clinical_query_terms: {
        Args: { input_query: string; min_sim?: number };
        Returns: string;
      };
      default_privileges_status: {
        Args: { p_role_name?: string; p_schema_name?: string };
        Returns: Json;
      };
      delete_document_if_idle: {
        Args: {
          p_document_bucket: string;
          p_document_id: string;
          p_image_bucket: string;
          p_owner_id: string;
        };
        Returns: Json;
      };
      retry_ingestion_job_if_idle: {
        Args: {
          p_document_updated_at: string;
          p_job_id: string;
          p_max_attempts: number;
          p_next_run_at: string;
          p_owner_id: string;
          p_stale_before: string;
        };
        Returns: Json;
      };
      request_ingestion_reindex_if_agent_idle: {
        Args: {
          p_document_id: string;
          p_max_attempts: number;
          p_owner_id: string;
          p_stale_before: string;
        };
        Returns: Json;
      };
      detect_legacy_ivfflat_indexes: { Args: never; Returns: string[] };
      document_label_metadata: {
        Args: { p_document_id: string };
        Returns: Json;
      };
      document_summary_text: {
        Args: { p_document_id: string };
        Returns: string;
      };
      explain_retrieval_rpc: {
        Args: {
          p_analyze?: boolean;
          p_document_filters?: string[] | null;
          p_match_count?: number;
          p_owner_filter?: string | null;
          p_query_text: string;
          p_rpc: string;
        };
        Returns: Json;
      };
      fail_or_retry_ingestion_job: {
        Args: {
          p_batch_id?: string | null;
          p_document_id: string;
          p_document_status?: string;
          p_error_message?: string;
          p_job_id: string;
          p_next_run_at?: string | null;
          p_retry?: boolean;
          p_stage?: string;
        };
        Returns: Json;
      };
      get_related_document_metadata: {
        Args: { document_ids: string[]; owner_filter?: string | null };
        Returns: {
          document_id: string;
          labels: Json;
          summary: string;
        }[];
      };
      get_related_document_metadata_v2: {
        Args: { document_ids: string[]; include_public?: boolean; owner_filter?: string };
        Returns: Database["public"]["Functions"]["get_related_document_metadata"]["Returns"];
      };
      get_visual_evidence_cards: {
        Args: { p_document_id: string; p_limit?: number };
        Returns: {
          image_caption: string;
          image_storage_path: string;
          image_type: string;
          page_number: number;
          source_image_id: string;
          unit_content: string;
          unit_id: string;
          unit_metadata: Json;
          unit_quality_score: number;
          unit_title: string;
          unit_type: string;
        }[];
      };
      invoke_indexing_v3_agent: { Args: { p_limit?: number }; Returns: number };
      request_indexing_v3_enrichment: {
        Args: { p_document_id: string; p_owner_id: string };
        Returns: { job_id?: string; ok?: boolean };
      };
      is_committed_artifact_generation: {
        Args: { artifact_metadata: Json; document_metadata: Json };
        Returns: boolean;
      };
      is_committed_document_generation: {
        Args: { document_metadata: Json; row_generation: string };
        Returns: boolean;
      };
      jsonb_merge_deep: {
        Args: {
          patch_obj?: Json;
          target_obj?: Json;
        };
        Returns: Json;
      };
      match_document_chunks: {
        Args: {
          document_filter?: string | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          document_labels: Json;
          document_summary: string;
          file_name: string;
          id: string;
          image_ids: string[];
          images: Json;
          page_number: number;
          retrieval_synopsis: string;
          section_heading: string;
          similarity: number;
          source_metadata: Json;
          title: string;
        }[];
      };
      match_document_lookup_chunks_text_v2: {
        Args: { query_text: string; document_filters: string[]; match_count?: number; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["match_document_lookup_chunks_text"]["Returns"];
      };
      match_documents_for_query_v2: {
        Args: { query_text: string; match_count?: number; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["match_documents_for_query"]["Returns"];
      };
      match_document_table_facts_text_v2: {
        Args: { query_text: string; match_count?: number; document_filters?: string[] | null; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["match_document_table_facts_text"]["Returns"];
      };
      match_document_embedding_fields_hybrid_v2: {
        Args: { query_embedding: Vector; query_text: string; match_count?: number; min_similarity?: number; document_filters?: string[] | null; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["match_document_embedding_fields_hybrid"]["Returns"];
      };
      match_document_index_units_hybrid_v2: {
        Args: { query_embedding: Vector; query_text: string; match_count?: number; min_similarity?: number; document_filters?: string[] | null; owner_filter?: string; include_public?: boolean };
        Returns: Database["public"]["Functions"]["match_document_index_units_hybrid"]["Returns"];
      };
      match_document_chunks_v2: {
        Args: {
          document_filter?: string | null;
          include_public?: boolean;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string;
          query_embedding: Vector;
        };
        Returns: Database["public"]["Functions"]["match_document_chunks"]["Returns"];
      };
      match_document_chunks_v3: {
        Args: {
          corpus_scopes?: string[] | null;
          document_filter?: string | null;
          expected_site_change_epoch?: number | null;
          expected_site_release_digest?: string | null;
          expected_site_release_id?: string | null;
          include_public?: boolean;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string;
          query_embedding: Vector;
          site_content_domains?: string[] | null;
        };
        Returns: {
          chunk_index: number;
          content: string;
          corpus_scope: string;
          document_id: string;
          document_labels: Json;
          document_summary: string | null;
          file_name: string;
          id: string;
          image_ids: string[];
          images: Json;
          page_number: number | null;
          pending_exclusion_exact: boolean;
          retrieval_synopsis: string | null;
          section_heading: string | null;
          similarity: number;
          site_change_epoch: number | null;
          site_content_domain: string | null;
          site_release_id: string | null;
          source_metadata: Json;
          title: string;
        }[];
      };
      match_document_chunks_hybrid: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          page_number: number;
          retrieval_synopsis: string;
          rrf_score: number;
          section_heading: string;
          similarity: number;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_chunks_hybrid_v2: {
        Args: {
          document_filters?: string[] | null;
          include_public?: boolean;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: Database["public"]["Functions"]["match_document_chunks_hybrid"]["Returns"];
      };
      match_document_chunks_hybrid_v3: {
        Args: {
          corpus_scopes?: string[] | null;
          document_filters?: string[] | null;
          expected_site_change_epoch?: number | null;
          expected_site_release_digest?: string | null;
          expected_site_release_id?: string | null;
          include_public?: boolean;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string;
          query_embedding: Vector;
          query_text: string;
          site_content_domains?: string[] | null;
        };
        Returns: {
          chunk_index: number;
          content: string;
          corpus_scope: string;
          document_id: string;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          page_number: number | null;
          pending_exclusion_exact: boolean;
          retrieval_synopsis: string | null;
          rrf_score: number;
          section_heading: string | null;
          similarity: number;
          site_change_epoch: number | null;
          site_content_domain: string | null;
          site_release_id: string | null;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_chunks_text: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          owner_filter?: string | null;
          query_text: string;
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          document_labels: Json;
          document_summary: string;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          page_number: number;
          retrieval_synopsis: string;
          section_heading: string;
          similarity: number;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_chunks_text_v2: {
        Args: {
          document_filters?: string[] | null;
          include_public?: boolean;
          match_count?: number;
          owner_filter?: string;
          query_text: string;
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          document_labels: Json;
          document_summary: string;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          lexical_score: number;
          page_number: number;
          retrieval_synopsis: string;
          section_heading: string;
          similarity: number;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_chunks_text_scoped: {
        Args: {
          document_filters: string[] | null;
          include_public: boolean;
          match_count: number;
          owner_filter: string | null;
          query_text: string;
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          document_labels: Json;
          document_summary: string;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          lexical_score: number;
          page_number: number;
          retrieval_synopsis: string;
          section_heading: string;
          similarity: number;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_chunks_text_v3: {
        Args: {
          corpus_scopes?: string[] | null;
          document_filters?: string[] | null;
          expected_site_change_epoch?: number | null;
          expected_site_release_digest?: string | null;
          expected_site_release_id?: string | null;
          include_public?: boolean;
          match_count?: number;
          owner_filter?: string;
          query_text: string;
          site_content_domains?: string[] | null;
        };
        Returns: {
          chunk_index: number;
          content: string;
          corpus_scope: string;
          document_id: string;
          document_labels: Json;
          document_summary: string | null;
          file_name: string;
          hybrid_score: number;
          id: string;
          image_ids: string[];
          images: Json;
          lexical_score: number;
          page_number: number | null;
          pending_exclusion_exact: boolean;
          retrieval_synopsis: string | null;
          section_heading: string | null;
          similarity: number;
          site_change_epoch: number | null;
          site_content_domain: string | null;
          site_release_id: string | null;
          source_metadata: Json;
          text_rank: number;
          title: string;
        }[];
      };
      match_document_embedding_fields_hybrid: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: {
          content: string;
          document_id: string;
          field_type: string;
          hybrid_score: number;
          id: string;
          similarity: number;
          source_chunk_id: string;
          text_rank: number;
        }[];
      };
      match_document_embedding_fields_text: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_text_rank?: number;
          owner_filter?: string | null;
          query_text: string;
        };
        Returns: {
          content: string;
          document_id: string;
          field_type: string;
          id: string;
          source_chunk_id: string;
          text_rank: number;
        }[];
      };
      match_document_index_units_hybrid: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: {
          content: string;
          document_id: string;
          extraction_mode: string;
          heading_path: string[];
          hybrid_score: number;
          id: string;
          metadata: Json;
          normalized_terms: string[];
          page_end: number;
          page_start: number;
          quality_score: number;
          similarity: number;
          source_chunk_id: string;
          source_image_id: string;
          source_span: Json;
          text_rank: number;
          title: string;
          unit_type: string;
        }[];
      };
      match_document_index_units_hybrid_scoped: {
        Args: {
          document_filters: string[] | null;
          include_public: boolean;
          match_count: number;
          min_similarity: number;
          owner_filter: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: Database["public"]["Functions"]["match_document_index_units_hybrid"]["Returns"];
      };
      match_document_lookup_chunks_text: {
        Args: {
          document_filters: string[] | null;
          match_count?: number;
          owner_filter?: string | null;
          query_text: string;
        };
        Returns: {
          anchor_id: string;
          chunk_index: number;
          content: string;
          document_id: string;
          heading_level: number;
          id: string;
          image_ids: string[];
          page_number: number;
          parent_heading: string;
          retrieval_synopsis: string;
          section_heading: string;
          section_path: string[];
          text_rank: number;
        }[];
      };
      match_document_memory_cards_hybrid: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: {
          card_type: string;
          confidence: number;
          content: string;
          document_id: string;
          hybrid_score: number;
          id: string;
          metadata: Json;
          normalized_terms: string[];
          owner_id: string;
          page_number: number;
          rrf_score: number;
          section_id: string;
          similarity: number;
          source_chunk_ids: string[];
          source_image_ids: string[];
          text_rank: number;
          title: string;
        }[];
      };
      match_document_memory_cards_hybrid_v2: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string | null;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: {
          card_type: string;
          confidence: number;
          content: string;
          document_id: string;
          hybrid_score: number;
          id: string;
          metadata: Json;
          normalized_terms: string[];
          owner_id: string;
          page_number: number;
          rrf_score: number;
          section_id: string;
          similarity: number;
          source_chunk_ids: string[];
          source_image_ids: string[];
          text_rank: number;
          title: string;
        }[];
      };
      match_document_memory_cards_hybrid_v3: {
        Args: {
          document_filters?: string[] | null;
          include_public?: boolean;
          match_count?: number;
          min_similarity?: number;
          owner_filter?: string;
          query_embedding: Vector;
          query_text: string;
        };
        Returns: Database["public"]["Functions"]["match_document_memory_cards_hybrid_v2"]["Returns"];
      };
      match_document_table_facts_text: {
        Args: {
          document_filters?: string[] | null;
          match_count?: number;
          owner_filter?: string | null;
          query_text: string;
        };
        Returns: {
          action: string;
          clinical_parameter: string;
          document_id: string;
          id: string;
          match_reason: string;
          page_number: number;
          row_label: string;
          source_chunk_id: string;
          source_image_id: string;
          table_title: string;
          text_rank: number;
          threshold_value: string;
        }[];
      };
      match_documents_for_query: {
        Args: {
          match_count?: number;
          owner_filter?: string | null;
          query_text: string;
        };
        Returns: {
          chunk_count: number;
          file_name: string;
          id: string;
          image_count: number;
          match_reason: string;
          metadata: Json;
          owner_id: string;
          page_count: number;
          status: string;
          text_rank: number;
          title: string;
        }[];
      };
      retrieval_owner_matches: {
        Args: { owner_filter: string; row_owner_id: string | null };
        Returns: boolean;
      };
      retrieval_owner_matches_v2: {
        Args: { owner_filter: string; row_owner_id: string | null; include_public?: boolean };
        Returns: boolean;
      };
      document_publication_state_digest: {
        Args: { p_document_id: string; p_expected_owner_id: string };
        Returns: string;
      };
      activate_approved_public_documents: {
        Args: {
          p_manifest: Json;
          p_expected_state_digest: string;
          p_expected_generation_ids: string[];
        };
        Returns: Json;
      };
      record_public_source_activation: {
        Args: { p_manifest: Json };
        Returns: Database["public"]["Tables"]["public_source_activation_events"]["Row"];
      };
      preflight_public_source_acquisition: {
        Args: { p_manifest: Json };
        Returns: Json;
      };
      reserve_public_source_version: {
        Args: { p_manifest: Json };
        Returns: Database["public"]["Tables"]["public_source_versions"]["Row"];
      };
      authorize_public_source_upload: {
        Args: { p_manifest: Json };
        Returns: Json;
      };
      bind_public_source_upload_authority: {
        Args: { p_manifest: Json };
        Returns: Json;
      };
      reap_expired_public_source_upload_attempts: {
        Args: { p_limit: number };
        Returns: number;
      };
      claim_public_source_cleanup_job: {
        Args: { p_max_attempts: number };
        Returns: Json;
      };
      complete_public_source_cleanup_job: {
        Args: { p_claim_token: string; p_job_id: string; p_storage_removed: number };
        Returns: Json;
      };
      release_public_source_cleanup_job: {
        Args: { p_claim_token: string; p_error: string; p_job_id: string };
        Returns: Json;
      };
      finalize_public_source_version: {
        Args: { p_manifest: Json; p_max_attempts: number };
        Returns: Database["public"]["Tables"]["public_source_versions"]["Row"];
      };
      abandon_public_source_reservation: {
        Args: { p_manifest: Json };
        Returns: Json;
      };
      activate_public_source_version: {
        Args: {
          p_activation_event_id: string;
          p_expected_generation_ids: string[];
          p_expected_state_digest: string;
          p_publication_manifest: Json;
          p_version_id: string;
        };
        Returns: Database["public"]["Tables"]["public_source_versions"]["Row"];
      };
      transition_public_source_version: {
        Args: { p_activation_event_id: string; p_target_lifecycle: string; p_version_id: string };
        Returns: Database["public"]["Tables"]["public_source_versions"]["Row"];
      };
      withdraw_public_source_version: {
        Args: { p_operator_id: string; p_reason: string; p_version_id: string };
        Returns: Json;
      };
      publish_approved_documents: {
        Args: {
          p_documents: Json;
          p_expected_count: number;
          p_manifest_digest: string;
        };
        Returns: Json;
      };
      record_site_content_reconciliation_plan: {
        Args: { p_plan: Json };
        Returns: boolean;
      };
      publish_site_content_record: {
        Args: { p_kind: string; p_source_row_id: string; p_expected_source_version: string; p_expected_change_epoch: number; p_reconciliation_plan_digest: string | null; p_expected_record_digest: string; p_expected_projection_digest: string };
        Returns: { outcome: string; conflict_code: string | null; logical_id: string | null; publication_id: string | null; event_sequence: number | null; change_epoch: number | null }[];
      };
      retire_site_content_record: Database["public"]["Functions"]["publish_site_content_record"];
      record_site_content_sync_worker_invocation: {
        Args: { p_worker_id: string; p_invocation_id: string; p_phase: string; p_outcome_code?: string | null };
        Returns: boolean;
      };
      read_site_content_health: { Args: Record<PropertyKey, never>; Returns: Json };
      read_site_content_public_records: {
        Args: { p_kind: string; p_slug?: string | null };
        Returns: { initialized: boolean; record: Json | null; render_payload: Json | null; snapshot: Json }[];
      };
      claim_site_content_sync_events: {
        Args: { p_worker_id: string; p_limit: number; p_lease_seconds: number };
        Returns: Database["public"]["Tables"]["site_content_sync_events"]["Row"][];
      };
      heartbeat_site_content_sync_event: {
        Args: { p_event_sequence: number; p_worker_id: string; p_lease_token: string; p_lease_generation: number; p_lease_seconds: number };
        Returns: boolean;
      };
      record_site_content_sync_event_plan: {
        Args: { p_event_sequence: number; p_expected_change_epoch: number; p_plan_digest: string; p_plan: Json };
        Returns: boolean;
      };
      read_site_content_sync_event_plan: {
        Args: { p_event_sequence: number; p_worker_id: string; p_lease_token: string; p_lease_generation: number };
        Returns: Json;
      };
      stage_site_content_sync_event: {
        Args: { p_event_sequence: number; p_worker_id: string; p_lease_token: string; p_lease_generation: number; p_stage: Json };
        Returns: boolean;
      };
      fail_site_content_sync_event: {
        Args: { p_event_sequence: number; p_worker_id: string; p_lease_token: string; p_lease_generation: number; p_error_code: string };
        Returns: boolean;
      };
      activate_site_content_release: {
        Args: { p_release_id: string; p_expected_release_digest: string; p_expected_change_epoch: number; p_recovery_digest: string; p_activation_receipt: Json };
        Returns: boolean;
      };
      rollback_site_content_release: {
        Args: { p_expected_active_release_id: string; p_target_release_id: string; p_recovery_digest: string; p_rollback_receipt: Json };
        Returns: boolean;
      };
      purge_expired_rag_queries: {
        Args: { p_retention_days?: number };
        Returns: number;
      };
      purge_expired_rag_query_misses: {
        Args: { p_retention_days?: number };
        Returns: number;
      };
      refresh_import_batch_status: {
        Args: { p_batch_id: string };
        Returns: Json;
      };
      repair_enrichment_quality_batch: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      preview_strict_enrichment_gate_repair: {
        Args: { p_limit?: number };
        Returns: Database["public"]["Views"]["document_strict_gate_status"]["Row"][];
      };
      repair_strict_enrichment_gate_batch: {
        Args: { p_limit?: number };
        Returns: {
          counts: Json;
          document_id: string;
          missing: string[];
          presence: Json;
          repaired: string[];
          status: string;
        }[];
      };
      reset_document_index: {
        Args: { p_document_id: string };
        Returns: undefined;
      };
      run_all_visual_eval_cases: { Args: { p_limit?: number }; Returns: Json };
      run_visual_eval_case: {
        Args: { p_case_id: string; p_limit?: number };
        Returns: Json;
      };
      search_document_chunks: {
        Args: {
          match_count?: number;
          p_document_id: string;
          p_owner_id?: string;
          p_query: string;
        };
        Returns: {
          chunk_index: number;
          content: string;
          id: string;
          image_ids: string[];
          page_number: number;
          section_heading: string;
          text_rank: number;
          trigram_score: number;
        }[];
      };
      migration_history_versions: { Args: never; Returns: Json };
      schema_drift_snapshot: { Args: never; Returns: Json };
      search_schema_health: { Args: never; Returns: Json };
      set_document_corpus_access_mode: {
        Args: { p_mode: string };
        Returns: Json;
      };
      stamp_document_deep_memory_version: {
        Args: { p_document_id: string; p_version: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
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
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
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
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
    Enums: {},
  },
} as const;
