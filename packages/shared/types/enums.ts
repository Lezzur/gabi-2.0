export const ContainerState = {
  InDistribution: 'in_distribution',
  PendingPurchase: 'pending_purchase',
  Purchased: 'purchased',
  Returned: 'returned',
  RewardsPaid: 'rewards_paid',
} as const;
export type ContainerState = typeof ContainerState[keyof typeof ContainerState];

export const ProductStatus = {
  Draft: 'draft',
  Active: 'active',
  Suspended: 'suspended',
} as const;
export type ProductStatus = typeof ProductStatus[keyof typeof ProductStatus];

export const ActorType = {
  Farmer: 'farmer',
  Dealer: 'dealer',
  Admin: 'admin',
} as const;
export type ActorType = typeof ActorType[keyof typeof ActorType];

export const ScanStep = {
  PurchaseDealer: 'purchase_dealer',
  PurchaseFarmer: 'purchase_farmer',
  ReturnDealer: 'return_dealer',
  ReturnFarmer: 'return_farmer',
} as const;
export type ScanStep = typeof ScanStep[keyof typeof ScanStep];

export const ScanOutcome = {
  Success: 'success',
  HmacInvalid: 'hmac_invalid',
  AuthRequired: 'auth_required',
  FpaBlocked: 'fpa_blocked',
  AlreadyClaimed: 'already_claimed',
  WindowExpired: 'window_expired',
  StateMismatch: 'state_mismatch',
  ConditionRejected: 'condition_rejected',
  ProductDraft: 'product_draft',
  RateLimited: 'rate_limited',
} as const;
export type ScanOutcome = typeof ScanOutcome[keyof typeof ScanOutcome];

export const FormulationType = {
  EC: 'EC',
  SC: 'SC',
  WP: 'WP',
  WG: 'WG',
  SL: 'SL',
  GR: 'GR',
  DP: 'DP',
  ULV: 'ULV',
  Other: 'OTHER',
} as const;
export type FormulationType = typeof FormulationType[keyof typeof FormulationType];

export const ToxicityCategory = {
  Category1: '1',
  Category2: '2',
  Category3: '3',
  Category4: '4',
} as const;
export type ToxicityCategory = typeof ToxicityCategory[keyof typeof ToxicityCategory];

export const ProductType = {
  Herbicide: 'HERBICIDE',
  Insecticide: 'INSECTICIDE',
  Fungicide: 'FUNGICIDE',
  Rodenticide: 'RODENTICIDE',
  Molluscicide: 'MOLLUSCICIDE',
  Nematicide: 'NEMATICIDE',
  Acaricide: 'ACARICIDE',
  Other: 'OTHER',
} as const;
export type ProductType = typeof ProductType[keyof typeof ProductType];

export const VoucherDenomination = {
  Php50: 'PHP_50',
  Php100: 'PHP_100',
  Php200: 'PHP_200',
  Php500: 'PHP_500',
} as const;
export type VoucherDenomination = typeof VoucherDenomination[keyof typeof VoucherDenomination];
