/**
 * Lazy V1 Object Storage config — missing env must not crash Legacy build.
 * Values are never logged.
 */

import { StorageError } from "./errors";

export type V1ObjectStorageConfig = {
  provider: "S3_COMPATIBLE";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let cached: V1ObjectStorageConfig | null = null;

export function isV1ObjectStorageConfigured(): boolean {
  return Boolean(
    process.env.V1_OBJECT_STORAGE_ENDPOINT?.trim() &&
      process.env.V1_OBJECT_STORAGE_BUCKET?.trim() &&
      process.env.V1_OBJECT_STORAGE_ACCESS_KEY_ID?.trim() &&
      process.env.V1_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim()
  );
}

export function getV1ObjectStorageConfig(): V1ObjectStorageConfig {
  if (cached) return cached;

  const endpoint = process.env.V1_OBJECT_STORAGE_ENDPOINT?.trim();
  const bucket = process.env.V1_OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.V1_OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    process.env.V1_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  const region =
    process.env.V1_OBJECT_STORAGE_REGION?.trim() || "auto";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageError(
      "STORAGE_CONFIGURATION_ERROR",
      "V1 object storage is not configured"
    );
  }

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

/** Test-only: clear cached config after env changes. */
export function resetV1ObjectStorageConfigCache(): void {
  cached = null;
}
