// Static catalog data — sourced from PostgreSQL snapshot (alembic_version 002)
import brandsRaw from "./db/brands.json";
import segmentsRaw from "./db/segments.json";
import modelsRaw from "./db/models.json";
import variantsRaw from "./db/car_variants.json";
import featuresRaw from "./db/car_features.json";

export interface DbBrand {
  id: number;
  name: string;
  country: string;
  is_active: boolean;
}

export interface DbSegment {
  id: number;
  name: string;
  category_type: string;
  description: string;
}

export interface DbModel {
  id: number;
  brand_id: number;
  segment_id: number;
  name: string;
  body_type: string;
  start_year: number;
  end_year: number | null;
}

export interface DbCarVariant {
  id: number;
  model_id: number;
  trim_name: string;
  year: number;
  fuel_type: string | null;
  transmission: string | null;
  engine_cc: number | null;
  horsepower: number | null;
  torque_nm: number | null;
  drivetrain: string | null;
  combined_fuel_consumption: number | null;
  zero_to_hundred: number | null;
  top_speed: number | null;
  seat_count: number | null;
  luggage_capacity: number | null;
  weight_kg: number | null;
}

export interface DbCarFeature {
  id: number;
  car_variant_id: number;
  feature_category: string;
  feature_name: string;
  feature_value: string;
}

export const brands: DbBrand[] = brandsRaw as DbBrand[];
export const segments: DbSegment[] = segmentsRaw as DbSegment[];
export const models: DbModel[] = modelsRaw as DbModel[];
export const variants: DbCarVariant[] = variantsRaw as DbCarVariant[];
export const features: DbCarFeature[] = featuresRaw as DbCarFeature[];

// --- Lookups ---

export const brandById = (id: number) => brands.find((b) => b.id === id);
export const segmentById = (id: number) => segments.find((s) => s.id === id);
export const modelById = (id: number) => models.find((m) => m.id === id);
export const variantById = (id: number) => variants.find((v) => v.id === id);

export const featuresForVariant = (variantId: number) =>
  features.filter((f) => f.car_variant_id === variantId);

export interface ResolvedVariant {
  variant: DbCarVariant;
  model: DbModel;
  brand: DbBrand;
  segment: DbSegment;
  features: DbCarFeature[];
}

export const resolveVariant = (variantId: number): ResolvedVariant | null => {
  const v = variantById(variantId);
  if (!v) return null;
  const m = modelById(v.model_id);
  if (!m) return null;
  const b = brandById(m.brand_id);
  const s = segmentById(m.segment_id);
  if (!b || !s) return null;
  return { variant: v, model: m, brand: b, segment: s, features: featuresForVariant(v.id) };
};

export const allResolvedVariants = (): ResolvedVariant[] =>
  variants
    .map((v) => resolveVariant(v.id))
    .filter((x): x is ResolvedVariant => x !== null);
