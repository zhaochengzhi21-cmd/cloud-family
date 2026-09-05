CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relation" text DEFAULT 'SUPPORTS' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claim_evidence_claim_id_evidence_id_pk" PRIMARY KEY("claim_id","evidence_id"),
	CONSTRAINT "claim_evidence_relation_ck" CHECK ("claim_evidence"."relation" IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT'))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"normalized_json" jsonb,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"confidence" numeric(4, 3),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "claims_subject_type_ck" CHECK ("claims"."subject_type" IN ('FAMILY', 'PERSON', 'RELATIONSHIP')),
	CONSTRAINT "claims_status_ck" CHECK ("claims"."status" IN ('PROPOSED', 'ACCEPTED', 'CONFLICTED', 'REJECTED')),
	CONSTRAINT "claims_confidence_ck" CHECK ("claims"."confidence" IS NULL OR ("claims"."confidence" >= 0 AND "claims"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"title" text,
	"description" text,
	"media_object_id" uuid,
	"source_locator" text,
	"source_date_text" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "evidence_type_ck" CHECK ("evidence"."evidence_type" IN ('GENEALOGY_PAGE', 'PHOTO', 'TOMBSTONE', 'ORAL_HISTORY', 'DOCUMENT', 'ARCHIVE', 'USER_TESTIMONY', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"surname" text,
	"visibility" text DEFAULT 'PRIVATE' NOT NULL,
	"discovery_enabled" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"current_version_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "families_visibility_ck" CHECK ("families"."visibility" IN ('PRIVATE', 'LINK', 'PUBLIC'))
);
--> statement-breakpoint
CREATE TABLE "family_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "family_memberships_role_ck" CHECK ("family_memberships"."role" IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')),
	CONSTRAINT "family_memberships_status_ck" CHECK ("family_memberships"."status" IN ('ACTIVE', 'SUSPENDED'))
);
--> statement-breakpoint
CREATE TABLE "family_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"created_by_user_id" uuid,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"summary" text,
	"content_hash" text,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "family_versions_version_no_ck" CHECK ("family_versions"."version_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "legacy_family_maps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legacy_family_id" text,
	"legacy_ipfs_cid" text,
	"new_family_id" uuid,
	"source" text DEFAULT 'V0' NOT NULL,
	"migration_status" text DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legacy_family_maps_status_ck" CHECK ("legacy_family_maps"."migration_status" IN ('PENDING', 'DISCOVERED', 'MIGRATED', 'ARCHIVED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text,
	"byte_size" bigint,
	"sha256" text,
	"visibility" text DEFAULT 'PRIVATE' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_objects_provider_ck" CHECK ("media_objects"."storage_provider" IN ('LEGACY_IPFS', 'PRIVATE_OBJECT')),
	CONSTRAINT "media_objects_visibility_ck" CHECK ("media_objects"."visibility" IN ('PRIVATE', 'FAMILY', 'PUBLIC')),
	CONSTRAINT "media_objects_status_ck" CHECK ("media_objects"."status" IN ('ACTIVE', 'DELETED'))
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"preferred_name" text NOT NULL,
	"gender" text DEFAULT 'UNKNOWN' NOT NULL,
	"living_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"privacy_level" text DEFAULT 'INHERIT' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "persons_gender_ck" CHECK ("persons"."gender" IN ('MALE', 'FEMALE', 'UNKNOWN', 'OTHER')),
	CONSTRAINT "persons_living_status_ck" CHECK ("persons"."living_status" IN ('LIVING', 'DECEASED', 'UNKNOWN')),
	CONSTRAINT "persons_privacy_level_ck" CHECK ("persons"."privacy_level" IN ('INHERIT', 'PRIVATE', 'FAMILY', 'PUBLIC'))
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"status" text DEFAULT 'ACCEPTED' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "relationships_type_ck" CHECK ("relationships"."relationship_type" IN ('BIOLOGICAL_PARENT', 'ADOPTIVE_PARENT', 'STEP_PARENT', 'SPOUSE')),
	CONSTRAINT "relationships_status_ck" CHECK ("relationships"."status" IN ('PROPOSED', 'ACCEPTED', 'DISPUTED', 'REJECTED')),
	CONSTRAINT "relationships_no_self_ck" CHECK ("relationships"."from_person_id" <> "relationships"."to_person_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_lookup_hash" text,
	"email_ciphertext" "bytea",
	"email_key_version" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_versions" ADD CONSTRAINT "family_versions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_versions" ADD CONSTRAINT "family_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_family_maps" ADD CONSTRAINT "legacy_family_maps_new_family_id_families_id_fk" FOREIGN KEY ("new_family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_person_id_persons_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_person_id_persons_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_family_id_idx" ON "audit_events" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claims_family_id_idx" ON "claims" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "claims_subject_id_idx" ON "claims" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "claims_claim_type_idx" ON "claims" USING btree ("claim_type");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "evidence_family_id_idx" ON "evidence" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "evidence_media_object_id_idx" ON "evidence" USING btree ("media_object_id");--> statement-breakpoint
CREATE INDEX "families_created_by_user_id_idx" ON "families" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_memberships_family_user_uq" ON "family_memberships" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE INDEX "family_memberships_user_id_idx" ON "family_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "family_memberships_family_id_idx" ON "family_memberships" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_versions_family_version_uq" ON "family_versions" USING btree ("family_id","version_no");--> statement-breakpoint
CREATE INDEX "family_versions_family_id_idx" ON "family_versions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "legacy_family_maps_legacy_family_id_idx" ON "legacy_family_maps" USING btree ("legacy_family_id");--> statement-breakpoint
CREATE INDEX "legacy_family_maps_legacy_ipfs_cid_idx" ON "legacy_family_maps" USING btree ("legacy_ipfs_cid");--> statement-breakpoint
CREATE INDEX "legacy_family_maps_new_family_id_idx" ON "legacy_family_maps" USING btree ("new_family_id");--> statement-breakpoint
CREATE INDEX "media_objects_family_id_idx" ON "media_objects" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "media_objects_sha256_idx" ON "media_objects" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_storage_uq" ON "media_objects" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "persons_family_id_idx" ON "persons" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "persons_living_status_idx" ON "persons" USING btree ("living_status");--> statement-breakpoint
CREATE INDEX "relationships_family_id_idx" ON "relationships" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "relationships_from_person_id_idx" ON "relationships" USING btree ("from_person_id");--> statement-breakpoint
CREATE INDEX "relationships_to_person_id_idx" ON "relationships" USING btree ("to_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_active_edge_uq" ON "relationships" USING btree ("family_id","from_person_id","to_person_id","relationship_type") WHERE "relationships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lookup_hash_uq" ON "users" USING btree ("email_lookup_hash");