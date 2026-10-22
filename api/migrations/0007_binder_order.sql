-- Where each binder stands on the shelf, left to right (dragged into order in the app). NULL: not
-- placed yet, after the placed ones, oldest first.
ALTER TABLE binders ADD COLUMN position INTEGER;
