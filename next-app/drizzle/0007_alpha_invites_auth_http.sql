CREATE TABLE "alpha_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email_lookup_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD COLUMN "alpha_invite_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_invites_token_hash_uq" ON "alpha_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "alpha_invites_email_lookup_hash_idx" ON "alpha_invites" USING btree ("email_lookup_hash");--> statement-breakpoint
CREATE INDEX "alpha_invites_expires_at_idx" ON "alpha_invites" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_alpha_invite_id_alpha_invites_id_fk" FOREIGN KEY ("alpha_invite_id") REFERENCES "public"."alpha_invites"("id") ON DELETE set null ON UPDATE no action;