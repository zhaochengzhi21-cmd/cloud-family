/**
 * V1 Object Storage types — provider-neutral S3-compatible contract.
 */

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
  /** e.g. private, no-store */
  cacheControl?: string;
};

export type HeadObjectResult = {
  contentLength: number;
  contentType: string | undefined;
  etag: string | undefined;
};

export type SignedReadUrlResult = {
  url: string;
  expiresAt: Date;
  ttlSeconds: number;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  getSignedReadUrl(
    key: string,
    ttlSeconds: number
  ): Promise<SignedReadUrlResult>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Default signed READ TTL — bearer credential window. */
export const SIGNED_READ_URL_TTL_SECONDS = 60;
