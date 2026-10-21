-- The language each copy is printed in (en, fr, de, it, es, pt). Copies added before this are
-- taken as English.
ALTER TABLE collection_items ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
