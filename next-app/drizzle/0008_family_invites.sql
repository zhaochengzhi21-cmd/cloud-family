CREATE TABLE "family_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "family_invites_role_ck" CHECK ("family_invites"."role" IN ('ADMIN', 'EDITOR', 'VIEWER'))
);
--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_invites_token_hash_uq" ON "family_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "family_invites_family_id_idx" ON "family_invites" USING btree ("family_id");