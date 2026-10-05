-- A spent refresh token may be sent once more within the grace period (two
-- refreshes at once); retried_at records that one retry, so a further one
-- counts as a copy.
alter table mcp_refresh_tokens add column retried_at timestamptz;
