ALTER TABLE "people" ADD COLUMN "department" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "reminder_weekday" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "reminder_minute" integer DEFAULT 1020 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_permissions_list" CHECK ("people"."permissions" is null or jsonb_typeof("people"."permissions") = 'array');--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_reminder_weekday_range" CHECK ("company_settings"."reminder_weekday" is null or "company_settings"."reminder_weekday" between 0 and 6);--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_reminder_minute_range" CHECK ("company_settings"."reminder_minute" between 0 and 1439);