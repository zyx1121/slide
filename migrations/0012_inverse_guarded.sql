-- An inverse stored from now on is guarded (lib/deck/patch.ts): it pins the
-- slides and shapes it addresses by id and tests each place it changes, so a
-- revert re-points it at them (lib/editor/retarget.ts) and applies it as it
-- is. An older inverse is checked against its patch instead.
alter table revisions add column inverse_guarded boolean not null default false;
