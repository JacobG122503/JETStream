CREATE TABLE "person_extras" (
	"person_id" integer NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_extras_person_id_permission_pk" PRIMARY KEY("person_id","permission")
);
--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "role_name" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "person_extras" ADD CONSTRAINT "person_extras_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_known" CHECK ("invites"."role_id" is not null or "invites"."role_name" is not null);--> statement-breakpoint
-- What the built-in roles give is in the code (src/shared/permissions.ts); nothing is stored with them.
UPDATE "roles" SET "built_in" = true, "permissions" = '[]'::jsonb WHERE "key" IN ('administrator', 'manager', 'member') AND (NOT "built_in" OR "permissions" <> '[]'::jsonb);
