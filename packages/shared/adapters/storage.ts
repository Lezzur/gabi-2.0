/**
 * Storage adapter interface — signed URL upload/download over object storage.
 *
 * Infrastructure topology:
 *   - **Primary**  — Supabase Storage (backed by S3-compatible store).
 *   - **Mirror**   — Cloudflare R2 (same object key space, async replication).
 *
 * Implementations must write metadata/URLs against the primary; R2 replication
 * is handled asynchronously at the infrastructure layer and is transparent to
 * this interface.
 *
 * Object keys are the canonical identifier for idempotency.  Re-uploading an
 * existing key overwrites the object in place on both primary and mirror.
 *
 * The concrete implementation lives in `apps/crm`.
 */

import type { AdapterError, Result } from "./types.js";

/** Pre-signed URL that authorises a direct client-to-storage upload. */
export type SignedUploadUrl = Readonly<{
  /** PUT target URL including all required auth query parameters. */
  uploadUrl: string;
  /** Canonical object key (echoed from the request, used for confirmation). */
  objectKey: string;
  /** Wall-clock expiry of the signed URL.  Clients must begin the upload before this time. */
  expiresAt: Date;
}>;

/** Pre-signed URL that authorises a direct download from storage. */
export type SignedDownloadUrl = Readonly<{
  /** GET URL including all required auth query parameters. */
  downloadUrl: string;
  /** Wall-clock expiry of the signed URL. */
  expiresAt: Date;
}>;

export interface StorageAdapter {
  /**
   * Generate a pre-signed URL for a direct client-to-storage upload.
   *
   * @param objectKey   - Stable, caller-supplied key (e.g. `labels/{containerId}.jpg`).
   *   Idempotent by key — reusing a key overwrites the existing object without
   *   error.  Keys must not contain leading slashes.
   * @param contentType - MIME type of the object (e.g. `"image/jpeg"`).
   *   Stored as object metadata and enforced by the signed URL.
   * @param ttlSeconds  - URL validity window in seconds.  Defaults to 300 (5 min).
   *   Maximum is provider-defined (Supabase: 7 days).
   *
   * @timeout 15 seconds — URL generation is a lightweight metadata call;
   *   the implementation must not block longer than this before returning an error.
   *
   * @retry Idempotent by object key — safe to retry.  Each call generates a
   *   fresh signed URL; prior un-used URLs are invalidated only at their TTL.
   */
  getSignedUploadUrl(
    objectKey: string,
    contentType: string,
    ttlSeconds?: number,
  ): Promise<Result<SignedUploadUrl, AdapterError>>;

  /**
   * Generate a pre-signed URL for a direct download from storage.
   *
   * @param objectKey  - Key of the object to retrieve.  Returns
   *   `AdapterError` with `kind: "not_found"` if the object does not exist.
   * @param ttlSeconds - URL validity window in seconds.  Defaults to 300 (5 min).
   *
   * @timeout 15 seconds
   *
   * @retry Idempotent — safe to retry with the same arguments.
   */
  getSignedDownloadUrl(
    objectKey: string,
    ttlSeconds?: number,
  ): Promise<Result<SignedDownloadUrl, AdapterError>>;
}
