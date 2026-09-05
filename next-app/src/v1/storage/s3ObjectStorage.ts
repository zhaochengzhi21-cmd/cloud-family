/**
 * S3-compatible ObjectStorage adapter (R2 / AWS S3 / COS / OSS via custom endpoint).
 * Provider-specific SDK usage is confined to this module.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getV1ObjectStorageConfig } from "./config";
import { StorageError } from "./errors";
import type {
  HeadObjectResult,
  ObjectStorage,
  PutObjectInput,
  SignedReadUrlResult,
} from "./types";

export class S3CompatibleObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client?: S3Client, bucket?: string) {
    if (client && bucket) {
      this.client = client;
      this.bucket = bucket;
      return;
    }
    const cfg = getV1ObjectStorageConfig();
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
          CacheControl: input.cacheControl ?? "private, no-store",
        })
      );
    } catch (e) {
      throw new StorageError(
        "OBJECT_PUT_FAILED",
        e instanceof Error ? e.message : "put failed"
      );
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return {
        contentLength: Number(out.ContentLength ?? 0),
        contentType: out.ContentType,
        etag: out.ETag,
      };
    } catch (e) {
      if (
        e instanceof NotFound ||
        (e as { name?: string }).name === "NotFound" ||
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return null;
      }
      throw e;
    }
  }

  async getSignedReadUrl(
    key: string,
    ttlSeconds: number
  ): Promise<SignedReadUrlResult> {
    try {
      const expiresIn = Math.min(Math.max(1, ttlSeconds), 60);
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn }
      );
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      return { url, expiresAt, ttlSeconds: expiresIn };
    } catch (e) {
      throw new StorageError(
        "OBJECT_SIGN_FAILED",
        e instanceof Error ? e.message : "sign failed"
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
    } catch (e) {
      throw new StorageError(
        "OBJECT_DELETE_FAILED",
        e instanceof Error ? e.message : "delete failed"
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.headObject(key);
    return head != null;
  }
}
