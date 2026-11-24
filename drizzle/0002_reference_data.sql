-- Records every installation needs. No people, clients or credentials.
-- Migrations named *_reference_* hold only such data: resetting demo data runs them again.
INSERT INTO "company_settings" ("id") VALUES (1);
--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "built_in") VALUES
  ('administrator', 'Administrator', true),
  ('manager', 'Manager', true),
  ('member', 'Member', true);
--> statement-breakpoint
INSERT INTO "number_sequences" ("kind", "prefix", "minimum_digits") VALUES
  ('invoice', 'INV-', 4),
  ('estimate', 'EST-', 4);
--> statement-breakpoint
INSERT INTO "item_categories" ("name") VALUES ('Service'), ('Product');
