-- License order/customer tracking: who purchased each key and under which
-- storefront order number.
--
-- NOTE: the Pages Functions self-apply these columns at runtime
-- (functions/_lib/licenses.ts ensureLicenseOrderColumns) — running this file
-- manually is only needed for a database the app never touches, and it is
-- safe to skip on a live deployment. Statements error individually with
-- "duplicate column name" when already applied; that is harmless.

ALTER TABLE licenses ADD COLUMN order_id TEXT;
ALTER TABLE licenses ADD COLUMN customer_name TEXT;
ALTER TABLE licenses ADD COLUMN customer_email TEXT;
ALTER TABLE licenses ADD COLUMN customer_discord TEXT;
ALTER TABLE licenses ADD COLUMN order_source TEXT;   -- 'store' | 'admin'
ALTER TABLE licenses ADD COLUMN order_note TEXT;
ALTER TABLE licenses ADD COLUMN order_meta TEXT;     -- sanitized storefront payload snapshot
ALTER TABLE licenses ADD COLUMN purchased_at TEXT;

CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id);
