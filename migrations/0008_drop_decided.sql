-- Who decided an entry and when only mattered while agents' changes waited
-- to be accepted (0005); since 0007 every entry is decided by its author when
-- it is made, and nothing reads these.
alter table revisions
  drop column decided_kind,
  drop column decided_at;
