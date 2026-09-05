ALTER TABLE "claim_evidence" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "value_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "origin_type" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "visibility" text DEFAULT 'FAMILY' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_active_duplicate_uq" ON "claims" USING btree ("family_id","subject_type","subject_id","claim_type","value_fingerprint") WHERE "claims"."deleted_at" IS NULL AND "claims"."status" <> 'REJECTED';--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_origin_type_ck" CHECK ("claims"."origin_type" IN ('MANUAL', 'AI_EXTRACTION', 'IMPORT', 'MIGRATION'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_visibility_ck" CHECK ("evidence"."visibility" IN ('PRIVATE', 'FAMILY', 'PUBLIC'));