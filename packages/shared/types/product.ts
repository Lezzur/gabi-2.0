import type { FormulationType, ProductStatus, ProductType, ToxicityCategory } from './enums.js';
import type { ProductId, UserId } from './ids.js';

export type ProductCrop = Readonly<{
  id: string;
  crop: string;
  pests: string | null;
}>;

export type Product = Readonly<{
  id: ProductId;
  product_name: string;
  brand_name: string | null;
  company: string;
  active_ingredient: string;
  concentration: string | null;
  formulation_type: FormulationType | null;
  type: ProductType | null;
  category: ToxicityCategory | null;
  fpa_registration_number: string | null;
  fpa_registration_expires_at: string | null;
  fpa_last_imported_at: string | null;
  mode_of_entry: string | null;
  mode_of_action_group: string | null;
  dosage_rate: string | null;
  mrl: string | null;
  pre_harvest_interval: string | null;
  re_entry_period: string | null;
  distributor: string | null;
  formulated_by: string | null;
  imported_by: string | null;
  timing_of_application: string | null;
  note_to_physician: string | null;
  pests: string | null;
  status: ProductStatus;
  category_confirmed_by: UserId | null;
  category_confirmed_at: string | null;
  note_to_physician_confirmed_by: UserId | null;
  note_to_physician_confirmed_at: string | null;
  label_image_storage_path: string | null;
  crops: ReadonlyArray<ProductCrop>;
  created_at: string;
  updated_at: string;
}>;

export type ProductListItem = Readonly<{
  id: ProductId;
  product_name: string;
  company: string;
  active_ingredient: string;
  concentration: string | null;
  formulation_type: FormulationType | null;
  type: ProductType | null;
  category: ToxicityCategory | null;
  fpa_registration_number: string | null;
  fpa_registration_expires_at: string | null;
  status: ProductStatus;
  updated_at: string;
}>;

export type FpaStatus = 'valid' | 'expiring_soon' | 'expired';

export type ScanProductInfo = Readonly<{
  product_name: string;
  brand_name: string | null;
  company: string;
  active_ingredient: string;
  concentration: string | null;
  formulation_type: FormulationType | null;
  type: ProductType | null;
  category: ToxicityCategory | null;
  fpa_registration_number: string | null;
  fpa_registration_expires_at: string | null;
  fpa_status: FpaStatus;
  mode_of_entry: string | null;
  mode_of_action_group: string | null;
  dosage_rate: string | null;
  pre_harvest_interval: string | null;
  re_entry_period: string | null;
  note_to_physician: string | null;
  registered_crops: ReadonlyArray<Readonly<{ crop: string; pests: string | null }>>;
}>;
