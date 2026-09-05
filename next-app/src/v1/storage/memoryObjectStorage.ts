/**
 * In-memory ObjectStorage for smoke failure-path tests (no network).
 */

import { StorageError } from "./errors";
import type {
  HeadObjectResult,
  ObjectStorage,
  PutObjectInput,
  SignedReadUrlResult,
} from "./types";

type Entry = {
  body: Buffer;
  contentType: string;
};

export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Entry>();
  failPut = false;
  failDelete = false;
  lastSignedTtl: number | null = null;

  async putObject(input: PutObjectInput): Promise<void> {
    if (this.failPut) {
      throw new StorageError("OBJECT_PUT_FAILED", "forced put failure");
    }
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const e = this.objects.get(key);
    if (!e) return null;
    return {
      contentLength: e.body.length,
      contentType: e.contentType,
      etag: undefined,
    };
  }

  async getSignedReadUrl(
    key: string,
    ttlSeconds: number
  ): Promise<SignedReadUrlResult> {
    if (!this.objects.has(key)) {
      throw new StorageError("OBJECT_NOT_FOUND");
    }
    const expiresIn = Math.min(Math.max(1, ttlSeconds), 60);
    this.lastSignedTtl = expiresIn;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    // Opaque fake URL — never a real credential
    return {
      url: `memory://object/${encodeURIComponent(key)}?exp=${expiresAt.getTime()}`,
      expiresAt,
      ttlSeconds: expiresIn,
    };
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failDelete) {
      throw new StorageError("OBJECT_DELETE_FAILED", "forced delete failure");
    }
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
