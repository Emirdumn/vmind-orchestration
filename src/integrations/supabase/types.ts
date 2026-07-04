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
      brands: {
        Row: {
          country: string | null
          created_at: string
          id: number
          is_active: boolean
          name: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          id: number
          is_active?: boolean
          name: string
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      car_variants: {
        Row: {
          combined_fuel_consumption: number | null
          created_at: string
          drivetrain: string | null
          engine_cc: number | null
          fuel_type: string | null
          horsepower: number | null
          id: number
          luggage_capacity: number | null
          model_id: number
          seat_count: number | null
          top_speed: number | null
          torque_nm: number | null
          transmission: string | null
          trim_name: string
          weight_kg: number | null
          year: number | null
          zero_to_hundred: number | null
        }
        Insert: {
          combined_fuel_consumption?: number | null
          created_at?: string
          drivetrain?: string | null
          engine_cc?: number | null
          fuel_type?: string | null
          horsepower?: number | null
          id?: number
          luggage_capacity?: number | null
          model_id: number
          seat_count?: number | null
          top_speed?: number | null
          torque_nm?: number | null
          transmission?: string | null
          trim_name: string
          weight_kg?: number | null
          year?: number | null
          zero_to_hundred?: number | null
        }
        Update: {
          combined_fuel_consumption?: number | null
          created_at?: string
          drivetrain?: string | null
          engine_cc?: number | null
          fuel_type?: string | null
          horsepower?: number | null
          id?: number
          luggage_capacity?: number | null
          model_id?: number
          seat_count?: number | null
          top_speed?: number | null
          torque_nm?: number | null
          transmission?: string | null
          trim_name?: string
          weight_kg?: number | null
          year?: number | null
          zero_to_hundred?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "car_variants_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      market_listings: {
        Row: {
          accident_record_amount: number | null
          car_variant_id: number
          changed_parts_count: number | null
          city: string | null
          created_at: string
          currency: string
          district: string | null
          first_registration_date: string | null
          id: number
          is_active: boolean
          listing_date: string | null
          mileage_km: number | null
          model_year: number | null
          painted_parts_count: number | null
          price: number
          seller_type: string | null
          source_listing_id: string | null
          source_name: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          accident_record_amount?: number | null
          car_variant_id: number
          changed_parts_count?: number | null
          city?: string | null
          created_at?: string
          currency?: string
          district?: string | null
          first_registration_date?: string | null
          id?: number
          is_active?: boolean
          listing_date?: string | null
          mileage_km?: number | null
          model_year?: number | null
          painted_parts_count?: number | null
          price: number
          seller_type?: string | null
          source_listing_id?: string | null
          source_name?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          accident_record_amount?: number | null
          car_variant_id?: number
          changed_parts_count?: number | null
          city?: string | null
          created_at?: string
          currency?: string
          district?: string | null
          first_registration_date?: string | null
          id?: number
          is_active?: boolean
          listing_date?: string | null
          mileage_km?: number | null
          model_year?: number | null
          painted_parts_count?: number | null
          price?: number
          seller_type?: string | null
          source_listing_id?: string | null
          source_name?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_listings_car_variant_id_fkey"
            columns: ["car_variant_id"]
            isOneToOne: false
            referencedRelation: "car_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      market_stats: {
        Row: {
          avg_mileage: number | null
          avg_price: number | null
          calculated_at: string
          car_variant_id: number
          id: number
          max_price: number | null
          median_price: number | null
          min_price: number | null
          price_mileage_corr: number | null
          sample_size: number
          std_dev_price: number | null
          updated_at: string
          variance_price: number | null
        }
        Insert: {
          avg_mileage?: number | null
          avg_price?: number | null
          calculated_at?: string
          car_variant_id: number
          id?: number
          max_price?: number | null
          median_price?: number | null
          min_price?: number | null
          price_mileage_corr?: number | null
          sample_size: number
          std_dev_price?: number | null
          updated_at?: string
          variance_price?: number | null
        }
        Update: {
          avg_mileage?: number | null
          avg_price?: number | null
          calculated_at?: string
          car_variant_id?: number
          id?: number
          max_price?: number | null
          median_price?: number | null
          min_price?: number | null
          price_mileage_corr?: number | null
          sample_size?: number
          std_dev_price?: number | null
          updated_at?: string
          variance_price?: number | null
        }
        Relationships: []
      }
      models: {
        Row: {
          body_type: string | null
          brand_id: number
          created_at: string
          end_year: number | null
          id: number
          name: string
          segment_id: number | null
          start_year: number | null
        }
        Insert: {
          body_type?: string | null
          brand_id: number
          created_at?: string
          end_year?: number | null
          id: number
          name: string
          segment_id?: number | null
          start_year?: number | null
        }
        Update: {
          body_type?: string | null
          brand_id?: number
          created_at?: string
          end_year?: number | null
          id?: number
          name?: string
          segment_id?: number | null
          start_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "models_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      scraped_listings: {
        Row: {
          city: string | null
          first_seen_at: string
          id: string
          image: string | null
          km: number | null
          last_seen_at: string
          price: number | null
          search_url: string | null
          source: string
          title: string
          updated_at: string
          url: string
          year: number | null
        }
        Insert: {
          city?: string | null
          first_seen_at?: string
          id?: string
          image?: string | null
          km?: number | null
          last_seen_at?: string
          price?: number | null
          search_url?: string | null
          source: string
          title: string
          updated_at?: string
          url: string
          year?: number | null
        }
        Update: {
          city?: string | null
          first_seen_at?: string
          id?: string
          image?: string | null
          km?: number | null
          last_seen_at?: string
          price?: number | null
          search_url?: string | null
          source?: string
          title?: string
          updated_at?: string
          url?: string
          year?: number | null
        }
        Relationships: []
      }
      segments: {
        Row: {
          description: string | null
          id: number
          name: string
        }
        Insert: {
          description?: string | null
          id: number
          name: string
        }
        Update: {
          description?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
