-- The built-in roles between Manager and Administrator. What they give is in the code (src/shared/permissions.ts).
-- A role that someone made may already have one of the names.
UPDATE "roles" SET "name" = "name" || ' (custom ' || "id" || ')' WHERE NOT "built_in" AND lower("name") IN ('project manager', 'people admin', 'accounting', 'executive manager');
--> statement-breakpoint
UPDATE "roles" SET "name" = 'Project Manager' WHERE "key" = 'manager';
--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "built_in") VALUES
  ('people_admin', 'People Admin', true),
  ('accounting', 'Accounting', true),
  ('executive', 'Executive Manager', true);
