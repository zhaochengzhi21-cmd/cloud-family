/**
 * ObjectStorage factory — callers must not construct S3Client directly.
 */

import { S3CompatibleObjectStorage } from "./s3ObjectStorage";
import type { ObjectStorage } from "./types";

let singleton: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (!singleton) {
    singleton = new S3CompatibleObjectStorage();
  }
  return singleton;
}

/** Smoke / tests — inject memory or failing adapters. */
export function setObjectStorageForTests(storage: ObjectStorage | null): void {
  singleton = storage;
}
