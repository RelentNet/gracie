-- 0026: retire the "Needs Review" document status.
--
-- Nothing in the app lets anyone review a document or clear the flag, so it was a
-- dead-end badge on uploads and on the generated client summary/email. New writes
-- no longer set it; this flips every existing row back to `ready`. The enum value
-- stays (dropping a Postgres enum value is a type rewrite for no gain). Idempotent.
update documents set status = 'ready' where status = 'needs_review';
