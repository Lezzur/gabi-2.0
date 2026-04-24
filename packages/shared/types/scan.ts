import type { ContainerState, ScanStep } from './enums.js';
import type { ApiError } from './errors.js';
import type { ContainerId } from './ids.js';
import type { ScanProductInfo } from './product.js';

export type ScanRequest = {
  uuid: ContainerId;
  hmac: string;
  step: ScanStep;
  local_scan_ts: string;
  device_id: string;
  last_online_ts: string;
  condition_confirmed?: boolean;
};

type ScanContainerBase = Readonly<{
  id: ContainerId;
  state: ContainerState;
}>;

type ScanContainerWithExpiry = ScanContainerBase & Readonly<{
  formulation_expires_at: string;
  formulation_months_remaining: number;
}>;

type ScanMeta = Readonly<{ request_id: string }>;

export type ScanSuccessResponse = Readonly<{
  outcome: 'success';
  container: ScanContainerBase | ScanContainerWithExpiry;
  product: ScanProductInfo | null;
  message: string;
  rewards_credited: Readonly<{ farmer_points: number; dealer_points: number }> | null;
  fpa_warning: boolean;
  meta: ScanMeta;
}>;

export type ScanPendingConfirmationResponse = Readonly<{
  outcome: 'pending_confirmation';
  container: ScanContainerBase;
  message: string;
  pending_expires_at: string;
  fpa_warning: boolean;
  meta: ScanMeta;
}>;

export type ScanRejectedResponse = Readonly<{
  outcome: 'rejected';
  error: ApiError;
}>;

export type ScanResponse =
  | ScanSuccessResponse
  | ScanPendingConfirmationResponse
  | ScanRejectedResponse;
