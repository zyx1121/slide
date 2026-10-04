-- Every change to a deck is an entry in its history, not only document
-- edits: publishing, unpublishing, deleting and restoring are entries too.
-- An agent's risky action (publish, delete) waits as a request, the way its
-- edits wait as suggestions, until the member or an agent accepts it.
alter table revisions
  add column kind text not null default 'edit'
    check (kind in ('edit', 'publish', 'unpublish', 'delete', 'restore')),
  -- Who accepted, rejected or applied the entry, and when.
  add column decided_kind text check (decided_kind in ('member', 'agent')),
  add column decided_at timestamptz;

-- Deck actions carry no patch.
alter table revisions alter column patch set default '[]'::jsonb;

update revisions set decided_kind = author_kind, decided_at = created_at
where status = 'applied' and author_kind = 'member';

-- A deleted deck stays, with its history, until it is restored.
alter table decks add column deleted_at timestamptz;
