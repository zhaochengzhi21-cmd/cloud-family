/**
 * Zod schemas for Media HTTP — not Domain validation substitute.
 */

import { z } from "zod";

export const reserveMediaBodySchema = z
  .object({
    originalFilename: z.string().max(255).nullable().optional(),
    mimeType: z.string().min(1).max(128),
    byteSize: z.number().int().positive().max(250 * 1024 * 1024),
    visibility: z.enum(["PRIVATE", "FAMILY", "PUBLIC"]).optional(),
  })
  .strict();
