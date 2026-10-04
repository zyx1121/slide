-- Agents' edits and deck actions now apply at once, recorded in the history
-- like the member's, where any of them can be reverted. Suggestions and
-- requests still waiting are closed as not taken; their patches stay in the
-- record.
update revisions
set status = 'rejected', decided_at = now()
where status = 'suggested';
