/**
 * Lazy V1 Object Storage config — provider-neutral selection.
 * Missing env must not crash Legacy import/build.
 * Values are never logged.
 */

import { StorageError } from "./errors";

export type V1ObjectStorageProvider = "VERCEL_BLOB" | "S3_COMPATIBLE";

export type V1VercelBlobConfig = {
  provider: "VERCEL_BLOB";
  /** Present when using static Vercel-managed RW token (local / linked store). */
  hasReadWriteToken: boolean;
  /** Present when OIDC + store id can authenticate. */
  hasOidc: boolean;
  storeId: string | null;
  authModel: "OIDC" | "STATIC_VERCEL_MANAGED_TOKEN";
};

export type V1S3CompatibleConfig = {
  provider: "S3_COMPATIBLE";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type V1ObjectStorageConfig = V1VercelBlobConfig | V1S3CompatibleConfig;

let cached: V1ObjectStorageConfig | null = null;

function detectProvider(): V1ObjectStorageProvider | null {
  const explicit = process.env.V1_OBJECT_STORAGE_PROVIDER?.trim().toUpperCase();
  if (explicit === "VERCEL_BLOB") return "VERCEL_BLOB";
  if (explicit === "S3_COMPATIBLE") return "S3_COMPATIBLE";

  // Prefer Vercel Blob when its credentials are present (MVP default).
  if (
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    (process.env.VERCEL_OIDC_TOKEN?.trim() &&
      (process.env.BLOB_STORE_ID?.trim() ||
        process.env.V1_BLOB_STORE_ID?.trim()))
  ) {
    return "VERCEL_BLOB";
  }

  if (
    process.env.V1_OBJECT_STORAGE_ENDPOINT?.trim() &&
    process.env.V1_OBJECT_STORAGE_BUCKET?.trim() &&
    process.env.V1_OBJECT_STORAGE_ACCESS_KEY_ID?.trim() &&
    process.env.V1_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim()
  ) {
    return "S3_COMPATIBLE";
  }

  return null;
}

export function isV1ObjectStorageConfigured(): boolean {
  return detectProvider() != null;
}

export function getV1ObjectStorageConfig(): V1ObjectStorageConfig {
  if (cached) return cached;

  const provider = detectProvider();
  if (!provider) {
    throw new StorageError(
      "STORAGE_CONFIGURATION_ERROR",
      "V1 object storage is not configured"
    );
  }

  if (provider === "VERCEL_BLOB") {
    const storeId =
      process.env.BLOB_STORE_ID?.trim() ||
      process.env.V1_BLOB_STORE_ID?.trim() ||
      null;
    const hasReadWriteToken = Boolean(
      process.env.BLOB_READ_WRITE_TOKEN?.trim()
    );
    const hasOidc = Boolean(
      process.env.VERCEL_OIDC_TOKEN?.trim() && storeId
    );
    if (!hasReadWriteToken && !hasOidc) {
      throw new StorageError(
        "STORAGE_CONFIGURATION_ERROR",
        "Vercel Blob credentials missing"
      );
    }
    // Prefer OIDC on Vercel runtime; local smoke uses Vercel-managed RW token.
    const onVercel = Boolean(process.env.VERCEL);
    let authModel: "OIDC" | "STATIC_VERCEL_MANAGED_TOKEN";
    if (onVercel && hasOidc) authModel = "OIDC";
    else if (hasReadWriteToken) authModel = "STATIC_VERCEL_MANAGED_TOKEN";
    else if (hasOidc) authModel = "OIDC";
    else {
      throw new StorageError(
        "STORAGE_CONFIGURATION_ERROR",
        "Vercel Blob credentials missing"
      );
    }
    cached = {
      provider: "VERCEL_BLOB",
      hasReadWriteToken,
      hasOidc,
      storeId,
      authModel,
    };
    return cached;
  }

  const endpoint = process.env.V1_OBJECT_STORAGE_ENDPOINT!.trim();
  const bucket = process.env.V1_OBJECT_STORAGE_BUCKET!.trim();
  const accessKeyId = process.env.V1_OBJECT_STORAGE_ACCESS_KEY_ID!.trim();
  const secretAccessKey =
    process.env.V1_OBJECT_STORAGE_SECRET_ACCESS_KEY!.trim();
  const region = process.env.V1_OBJECT_STORAGE_REGION?.trim() || "auto";

  cached = {
    provider: "S3_COMPATIBLE",
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
  return cached;
}

export function resetV1ObjectStorageConfigCache(): void {
  cached = null;
}
