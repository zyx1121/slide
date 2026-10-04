-- Comments on what a member selected. A thread starts with a comment
-- anchored to a slide and its selected shapes; replies, resolving and
-- reopening are rows of their own. Nothing is edited or deleted, so the whole
-- conversation stays in the record.
create table comments (
  id bigint generated always as identity primary key,
  deck_id text not null references decks (id) on delete cascade,
  thread_id bigint references comments (id),  -- null on a thread's first row
  kind text not null check (kind in ('comment', 'reply', 'resolve', 'reopen')),
  author_kind text not null check (author_kind in ('member', 'agent')),
  author_sub text not null,                   -- the member, or the member an agent acts for
  slide_id text,                              -- the anchor, on the first row
  targets jsonb not null default '[]'::jsonb,
  body text not null default '' check (length(body) <= 5000),
  entry_id bigint references revisions (id),  -- a suggestion or change it points at
  created_at timestamptz not null default now(),
  check ((kind = 'comment') = (thread_id is null)),
  check ((kind = 'comment') = (slide_id is not null))
);

create index comments_deck on comments (deck_id, id);
create index comments_thread on comments (thread_id, id);
