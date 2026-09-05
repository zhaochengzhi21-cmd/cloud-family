CREATE TABLE "family_share_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_share_links" ADD CONSTRAINT "family_share_links_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_share_links" ADD CONSTRAINT "family_share_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_share_links_token_hash_uq" ON "family_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "family_share_links_family_id_idx" ON "family_share_links" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "family_share_links_expires_at_idx" ON "family_share_links" USING btree ("expires_at");