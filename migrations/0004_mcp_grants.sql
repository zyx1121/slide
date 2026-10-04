-- MCP clients get their tokens from Slide itself (lib/mcp/grants.ts). Codes
-- and refresh tokens are stored by their sha256, never as presented.
create table mcp_codes (
  hash text primary key,
  sub text not null references users (sub) on delete cascade on update cascade,
  client_id text not null,
  redirect_uri text not null,
  challenge text not null,                   -- PKCE S256 challenge
  scope text not null,
  expires_at timestamptz not null
);

-- A grant is a family of refresh tokens: each refresh spends one (used_at)
-- and adds the next. Deleting a family revokes the grant and every access
-- token issued under it.
create table mcp_refresh_tokens (
  hash text primary key,
  family text not null,
  sub text not null references users (sub) on delete cascade on update cascade,
  client_id text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index mcp_refresh_tokens_family on mcp_refresh_tokens (family);
