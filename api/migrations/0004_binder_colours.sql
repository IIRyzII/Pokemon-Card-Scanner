-- Each binder's colour on the shelf (one of BINDER_COLOURS in shared/binders.ts; NULL picks one
-- from its id).
ALTER TABLE binders ADD COLUMN colour TEXT;
