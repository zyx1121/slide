-- Who may use an image. An asset is stored once by its sha256, but every
-- member who uploads the same bytes owns it too, and only owners may read it
-- or draw it on their slides.
create table asset_owners (
  sha256 text not null references assets (sha256) on delete cascade,
  sub text not null references users (sub),
  created_at timestamptz not null default now(),
  primary key (sha256, sub)
);

insert into asset_owners (sha256, sub)
select sha256, uploader_sub from assets;
