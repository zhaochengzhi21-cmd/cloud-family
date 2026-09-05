CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_lookup_hash" text NOT NULL,
	"email_ciphertext" "bytea" NOT NULL,
	"email_key_version" integer NOT NULL,
	"code_digest" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_challenges_failed_attempts_ck" CHECK ("auth_challenges"."failed_attempts" >= 0),
	CONSTRAINT "auth_challenges_email_key_version_ck" CHECK ("auth_challenges"."email_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenges_email_lookup_hash_idx" ON "auth_challenges" USING btree ("email_lookup_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");