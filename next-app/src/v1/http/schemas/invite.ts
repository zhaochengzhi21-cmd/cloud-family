import { z } from "zod";

/** Raw invite tokens are 32 random bytes, base64url (43 chars). */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
