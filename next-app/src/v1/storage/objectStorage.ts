/**
 * ObjectStorage factory — callers must not construct provider clients directly.
 */

import { getV1ObjectStorageConfig } from "./config";
import { S3CompatibleObjectStorage } from "./s3ObjectStorage";
import { VercelBlobObjectStorage } from "./vercelBlobObjectStorage";
import type { ObjectStorage } from "./types";

let singleton: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (singleton) return singleton;

  const cfg = getV1ObjectStorageConfig();
  if (cfg.provider === "VERCEL_BLOB") {
    singleton = new VercelBlobObjectStorage();
  } else {
    singleton = new S3CompatibleObjectStorage();
  }
  return singleton;
}

/** Smoke / tests — inject memory or failing adapters. */
export function setObjectStorageForTests(storage: ObjectStorage | null): void {
  singleton = storage;
}
