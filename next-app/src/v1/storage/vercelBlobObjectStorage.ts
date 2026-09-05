/**
 * Vercel Private Blob ObjectStorage adapter.
 * Vendor-specific `@vercel/blob` usage is confined to this module.
 */

import {
  put,
  head,
  del,
  issueSignedToken,
  presignUrl,
  BlobNotFoundError,
} from "@vercel/blob";
import { getV1ObjectStorageConfig } from "./config";
import { StorageError } from "./errors";
import type {
  HeadObjectResult,
  ObjectStorage,
  PutObjectInput,
  SignedReadUrlResult,
} from "./types";

function authOptions(): {
  token?: string;
  oidcToken?: string;
  storeId?: string;
} {
  const cfg = getV1ObjectStorageConfig();
  if (cfg.provider !== "VERCEL_BLOB") {
    throw new StorageError(
      "STORAGE_CONFIGURATION_ERROR",
      "VercelBlob adapter requires VERCEL_BLOB provider"
    );
  }
  if (cfg.authModel === "OIDC" && cfg.storeId) {
    return {
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: cfg.storeId,
    };
  }
  return { token: process.env.BLOB_READ_WRITE_TOKEN };
}

export class VercelBlobObjectStorage implements ObjectStorage {
  async putObject(input: PutObjectInput): Promise<void> {
    try {
      await put(input.key, input.body, {
        access: "private",
        contentType: input.contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        // Prefer short / private caching; 0 = do not cache at edge where supported
        cacheControlMaxAge: 0,
        multipart: false,
        ...authOptions(),
      });
    } catch (e) {
      throw new StorageError(
        "OBJECT_PUT_FAILED",
        e instanceof Error ? e.message : "put failed"
      );
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const meta = await head(key, { ...authOptions() });
      return {
        contentLength: Number(meta.size),
        contentType: meta.contentType,
        etag: meta.etag,
      };
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|404/i.test(msg)) return null;
      throw e;
    }
  }

  async getSignedReadUrl(
    key: string,
    ttlSeconds: number
  ): Promise<SignedReadUrlResult> {
    try {
      const expiresIn = Math.min(Math.max(1, ttlSeconds), 60);
      const validUntil = Date.now() + expiresIn * 1000;
      const signedToken = await issueSignedToken({
        pathname: key,
        operations: ["get"],
        validUntil,
        ...authOptions(),
      });
      const { presignedUrl } = await presignUrl(signedToken, {
        access: "private",
        operation: "get",
        pathname: key,
        validUntil,
        useCache: false,
      });
      return {
        url: presignedUrl,
        expiresAt: new Date(validUntil),
        ttlSeconds: expiresIn,
      };
    } catch (e) {
      throw new StorageError(
        "OBJECT_SIGN_FAILED",
        e instanceof Error ? e.message : "sign failed"
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await del(key, { ...authOptions() });
    } catch (e) {
      throw new StorageError(
        "OBJECT_DELETE_FAILED",
        e instanceof Error ? e.message : "delete failed"
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const h = await this.headObject(key);
    return h != null;
  }
}
