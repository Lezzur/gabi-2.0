// AUTO-GENERATED — run pnpm db:types to regenerate
// Hand-written placeholder derived from supabase/migrations/0001_init.sql and
// supabase/migrations/0002_aux.sql. Covers all tables defined in those files.
// Replace with the real codegen output once a local Supabase instance is running.

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
      batch_generation_log: {
        Row: {
          id: string
          idempotency_key: string
          batch_id: string
          product_id: string
          quantity: number
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          idempotency_key: string
          batch_id: string
          product_id: string
          quantity: number
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          idempotency_key?: string
          batch_id?: string
          product_id?: string
          quantity?: number
          created_by?: string
          created_at?: string
        }
        Relationships: []
      }
      config_audit_log: {
        Row: {
          id: string
          table_name: string
          changed_by: string
          before: Record<string, unknown> | null
          after: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          table_name: string
          changed_by: string
          before?: Record<string, unknown> | null
          after: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          table_name?: string
          changed_by?: string
          before?: Record<string, unknown> | null
          after?: Record<string, unknown>
          created_at?: string
        }
        Relationships: []
      }
      ocr_jobs: {
        Row: {
          id: string
          user_id: string
          image_url: string
          status: 'queued' | 'processing' | 'completed' | 'failed'
          result: Record<string, unknown> | null
          error_code: string | null
          attempt_count: number
          started_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          image_url: string
          status?: 'queued' | 'processing' | 'completed' | 'failed'
          result?: Record<string, unknown> | null
          error_code?: string | null
          attempt_count?: number
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          image_url?: string
          status?: 'queued' | 'processing' | 'completed' | 'failed'
          result?: Record<string, unknown> | null
          error_code?: string | null
          attempt_count?: number
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      containers: {
        Row: {
          id: string
          product_id: string
          hmac: string
          hmac_suffix: string
          batch_number: string | null
          manufacture_date: string | null
          /** Generated column: manufacture_date + 2 years. */
          formulation_expires_at: string | null
          state: Database['public']['Enums']['container_state']
          purchased_by_user_id: string | null
          purchased_at: string | null
          returned_by_user_id: string | null
          returned_at: string | null
          rewards_paid_at: string | null
          dealer_id: string | null
          return_dealer_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          hmac: string
          hmac_suffix: string
          batch_number?: string | null
          manufacture_date?: string | null
          state?: Database['public']['Enums']['container_state']
          purchased_by_user_id?: string | null
          purchased_at?: string | null
          returned_by_user_id?: string | null
          returned_at?: string | null
          rewards_paid_at?: string | null
          dealer_id?: string | null
          return_dealer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          hmac?: string
          hmac_suffix?: string
          batch_number?: string | null
          manufacture_date?: string | null
          state?: Database['public']['Enums']['container_state']
          purchased_by_user_id?: string | null
          purchased_at?: string | null
          returned_by_user_id?: string | null
          returned_at?: string | null
          rewards_paid_at?: string | null
          dealer_id?: string | null
          return_dealer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_accounts: {
        Row: {
          id: string
          user_id: string
          business_name: string
          territory_notes: string | null
          is_verified: boolean
          verified_by: string | null
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          business_name: string
          territory_notes?: string | null
          is_verified?: boolean
          verified_by?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          business_name?: string
          territory_notes?: string | null
          is_verified?: boolean
          verified_by?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      manufacturer_accounts: {
        Row: {
          id: string
          user_id: string
          company_name: string
          onboarded_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company_name: string
          onboarded_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          company_name?: string
          onboarded_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_purchase: {
        Row: {
          id: string
          container_id: string
          dealer_id: string
          created_at: string
          /** Generated column: created_at + 60 minutes. */
          lazy_expires_at: string
        }
        Insert: {
          id?: string
          container_id: string
          dealer_id: string
          created_at?: string
        }
        Update: {
          id?: string
          container_id?: string
          dealer_id?: string
          created_at?: string
        }
        Relationships: []
      }
      pending_return_reward: {
        Row: {
          id: string
          container_id: string
          dealer_id: string
          created_at: string
          /** Generated column: created_at + 60 minutes. */
          lazy_expires_at: string
        }
        Insert: {
          id?: string
          container_id: string
          dealer_id: string
          created_at?: string
        }
        Update: {
          id?: string
          container_id?: string
          dealer_id?: string
          created_at?: string
        }
        Relationships: []
      }
      product_crops: {
        Row: {
          id: string
          product_id: string
          crop: string
          pests: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          crop: string
          pests?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          crop?: string
          pests?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          product_name: string
          brand_name: string | null
          company: string
          active_ingredient: string
          concentration: string | null
          formulation_type: Database['public']['Enums']['formulation_type'] | null
          type: Database['public']['Enums']['product_type'] | null
          category: Database['public']['Enums']['toxicity_category'] | null
          fpa_registration_number: string | null
          fpa_registration_expires_at: string | null
          fpa_last_imported_at: string | null
          mode_of_entry: string | null
          mode_of_action_group: string | null
          dosage_rate: string | null
          mrl: string | null
          pre_harvest_interval: string | null
          re_entry_period: string | null
          distributor: string | null
          formulated_by: string | null
          imported_by: string | null
          timing_of_application: string | null
          note_to_physician: string | null
          pests: string | null
          status: Database['public']['Enums']['product_status']
          category_confirmed_by: string | null
          category_confirmed_at: string | null
          note_to_physician_confirmed_by: string | null
          note_to_physician_confirmed_at: string | null
          label_image_storage_path: string | null
          creator_id: string | null
          ocr_job_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_name: string
          brand_name?: string | null
          company: string
          active_ingredient: string
          concentration?: string | null
          formulation_type?: Database['public']['Enums']['formulation_type'] | null
          type?: Database['public']['Enums']['product_type'] | null
          category?: Database['public']['Enums']['toxicity_category'] | null
          fpa_registration_number?: string | null
          fpa_registration_expires_at?: string | null
          fpa_last_imported_at?: string | null
          mode_of_entry?: string | null
          mode_of_action_group?: string | null
          dosage_rate?: string | null
          mrl?: string | null
          pre_harvest_interval?: string | null
          re_entry_period?: string | null
          distributor?: string | null
          formulated_by?: string | null
          imported_by?: string | null
          timing_of_application?: string | null
          note_to_physician?: string | null
          pests?: string | null
          status?: Database['public']['Enums']['product_status']
          category_confirmed_by?: string | null
          category_confirmed_at?: string | null
          note_to_physician_confirmed_by?: string | null
          note_to_physician_confirmed_at?: string | null
          label_image_storage_path?: string | null
          creator_id?: string | null
          ocr_job_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_name?: string
          brand_name?: string | null
          company?: string
          active_ingredient?: string
          concentration?: string | null
          formulation_type?: Database['public']['Enums']['formulation_type'] | null
          type?: Database['public']['Enums']['product_type'] | null
          category?: Database['public']['Enums']['toxicity_category'] | null
          fpa_registration_number?: string | null
          fpa_registration_expires_at?: string | null
          fpa_last_imported_at?: string | null
          mode_of_entry?: string | null
          mode_of_action_group?: string | null
          dosage_rate?: string | null
          mrl?: string | null
          pre_harvest_interval?: string | null
          re_entry_period?: string | null
          distributor?: string | null
          formulated_by?: string | null
          imported_by?: string | null
          timing_of_application?: string | null
          note_to_physician?: string | null
          pests?: string | null
          status?: Database['public']['Enums']['product_status']
          category_confirmed_by?: string | null
          category_confirmed_at?: string | null
          note_to_physician_confirmed_by?: string | null
          note_to_physician_confirmed_at?: string | null
          label_image_storage_path?: string | null
          creator_id?: string | null
          ocr_job_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_audit_log: {
        Row: {
          id: string
          product_id: string
          user_id: string
          action: string
          ocr_job_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product_id: string
          user_id: string
          action: string
          ocr_job_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          user_id?: string
          action?: string
          ocr_job_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      reward_config: {
        Row: {
          id: number
          farmer_points_per_return: number
          dealer_points_per_return: number
          voucher_cost_php_50: number
          voucher_cost_php_100: number
          voucher_cost_php_200: number
          voucher_cost_php_500: number
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id: number
          farmer_points_per_return?: number
          dealer_points_per_return?: number
          voucher_cost_php_50?: number
          voucher_cost_php_100?: number
          voucher_cost_php_200?: number
          voucher_cost_php_500?: number
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          farmer_points_per_return?: number
          dealer_points_per_return?: number
          voucher_cost_php_50?: number
          voucher_cost_php_100?: number
          voucher_cost_php_200?: number
          voucher_cost_php_500?: number
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scan_attempts: {
        Row: {
          id: string
          container_id: string | null
          actor_id: string | null
          actor_type: Database['public']['Enums']['actor_type'] | null
          step: Database['public']['Enums']['scan_step']
          outcome: Database['public']['Enums']['scan_outcome']
          hmac_valid: boolean
          auth_valid: boolean
          ip_address: string | null
          local_scan_ts: string | null
          sync_ts: string
          device_id: string | null
          last_online_ts: string | null
          sync_delayed: boolean
          created_at: string
        }
        Insert: {
          id?: string
          container_id?: string | null
          actor_id?: string | null
          actor_type?: Database['public']['Enums']['actor_type'] | null
          step: Database['public']['Enums']['scan_step']
          outcome: Database['public']['Enums']['scan_outcome']
          hmac_valid: boolean
          auth_valid: boolean
          ip_address?: string | null
          local_scan_ts?: string | null
          sync_ts?: string
          device_id?: string | null
          last_online_ts?: string | null
          sync_delayed?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          container_id?: string | null
          actor_id?: string | null
          actor_type?: Database['public']['Enums']['actor_type'] | null
          step?: Database['public']['Enums']['scan_step']
          outcome?: Database['public']['Enums']['scan_outcome']
          hmac_valid?: boolean
          auth_valid?: boolean
          ip_address?: string | null
          local_scan_ts?: string | null
          sync_ts?: string
          device_id?: string | null
          last_online_ts?: string | null
          sync_delayed?: boolean
          created_at?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          id: string
          role: string
          display_name: string | null
          phone_number: string | null
          locale: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          role?: string
          display_name?: string | null
          phone_number?: string | null
          locale?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          role?: string
          display_name?: string | null
          phone_number?: string | null
          locale?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          id: string
          user_id: string
          denomination: Database['public']['Enums']['voucher_denomination']
          expires_at: string
          redeemed_at: string | null
          redeemed_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          denomination: Database['public']['Enums']['voucher_denomination']
          expires_at: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          denomination?: Database['public']['Enums']['voucher_denomination']
          expires_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          id: string
          user_id: string
          delta: number
          reason: string
          scan_attempt_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          delta: number
          reason: string
          scan_attempt_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          delta?: number
          reason?: string
          scan_attempt_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wallet_transactions_scan_attempt_id_fkey'
            columns: ['scan_attempt_id']
            isOneToOne: false
            referencedRelation: 'scan_attempts'
            referencedColumns: ['id']
          },
        ]
      }
      wallets: {
        Row: {
          id: string
          user_id: string
          balance_points: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          balance_points?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          balance_points?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      redeem_voucher: {
        Args: {
          p_user_id: string
          p_denomination: Database['public']['Enums']['voucher_denomination']
        }
        Returns: Array<{ voucher_code: string; new_balance: number }>
      }
    }
    Enums: {
      actor_type: 'farmer' | 'dealer' | 'admin'
      container_state:
        | 'in_distribution'
        | 'pending_purchase'
        | 'purchased'
        | 'returned'
        | 'rewards_paid'
      formulation_type: 'EC' | 'SC' | 'WP' | 'WG' | 'SL' | 'GR' | 'DP' | 'ULV' | 'OTHER'
      product_status: 'draft' | 'active' | 'suspended'
      product_type:
        | 'HERBICIDE'
        | 'INSECTICIDE'
        | 'FUNGICIDE'
        | 'RODENTICIDE'
        | 'MOLLUSCICIDE'
        | 'NEMATICIDE'
        | 'ACARICIDE'
        | 'OTHER'
      scan_outcome:
        | 'success'
        | 'hmac_invalid'
        | 'auth_required'
        | 'fpa_blocked'
        | 'state_mismatch'
        | 'window_expired'
        | 'already_claimed'
        | 'condition_rejected'
        | 'product_draft'
        | 'rate_limited'
      scan_step: 'purchase_dealer' | 'purchase_farmer' | 'return_dealer' | 'return_farmer'
      toxicity_category: '1' | '2' | '3' | '4'
      voucher_denomination: 'PHP_50' | 'PHP_100' | 'PHP_200' | 'PHP_500'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience aliases (mirrors the pattern supabase codegen emits)
// ---------------------------------------------------------------------------

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row']

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']

export type Enums<T extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][T]
