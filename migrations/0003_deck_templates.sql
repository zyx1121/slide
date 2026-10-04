-- Decks pick a template, and a deck that names none is plain. Every deck
-- made before templates was drawn on the WinLab master, so it keeps it.
update decks
set document = jsonb_set(document, '{template}', '"winlab"')
where not document ? 'template';
