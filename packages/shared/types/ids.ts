export type UserId = string & { readonly __brand: 'UserId' };
export type ContainerId = string & { readonly __brand: 'ContainerId' };
export type ProductId = string & { readonly __brand: 'ProductId' };
export type DealerId = string & { readonly __brand: 'DealerId' };
export type ScanAttemptId = string & { readonly __brand: 'ScanAttemptId' };

export const asUserId = (s: string): UserId => s as UserId;
export const asContainerId = (s: string): ContainerId => s as ContainerId;
export const asProductId = (s: string): ProductId => s as ProductId;
export const asDealerId = (s: string): DealerId => s as DealerId;
export const asScanAttemptId = (s: string): ScanAttemptId => s as ScanAttemptId;
