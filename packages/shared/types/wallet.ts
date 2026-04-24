import type { ContainerId, UserId } from './ids.js';

export type WalletTransaction = Readonly<{
  id: string;
  container_id: ContainerId | null;
  points: number;
  description: string;
  created_at: string;
}>;

export type Voucher = Readonly<{
  id: string;
  points_cost: number;
  discount_value: number;
  description: string;
  redeemed: boolean;
  expires_at: string;
}>;

export type Wallet = Readonly<{
  id: string;
  user_id: UserId;
  balance_points: number;
  transactions: ReadonlyArray<WalletTransaction>;
  vouchers: ReadonlyArray<Voucher>;
  updated_at: string;
}>;

export type RedeemVoucherResponse = Readonly<{
  voucher_id: string;
  points_deducted: number;
  new_balance: number;
  discount_value: number;
  expires_at: string;
  qr_data: string;
}>;
