# Changelog

## [0.4.0](https://github.com/zyx1121/slide/compare/v0.3.0...v0.4.0) (2026-10-04)


### Features

* fewer dock tools, and delete decks without asking ([#142](https://github.com/zyx1121/slide/issues/142)) ([9a19d0e](https://github.com/zyx1121/slide/commit/9a19d0e31cd70aab2d5292818d975700d231bcdf))
* revert edits only; deck actions are undone by their opposite ([#143](https://github.com/zyx1121/slide/issues/143)) ([4af1d62](https://github.com/zyx1121/slide/commit/4af1d62870bdc48434c75d8d9966d59d8325105e))


### Bug fixes

* keep paragraph settings a text style change leaves alone ([#139](https://github.com/zyx1121/slide/issues/139)) ([bd7820d](https://github.com/zyx1121/slide/commit/bd7820da0579bed5cbd93f2c7a6511106b3939fb))

## [0.3.0](https://github.com/zyx1121/slide/compare/v0.2.0...v0.3.0) (2026-10-04)


### Features

* carry speaker notes through .pptx import and export ([#138](https://github.com/zyx1121/slide/issues/138)) ([50888d3](https://github.com/zyx1121/slide/commit/50888d3ee24ada360b0ed858674e5f6b9574b961))
* present a deck full screen, with a presenter view for a second screen ([#137](https://github.com/zyx1121/slide/issues/137)) ([28166f4](https://github.com/zyx1121/slide/commit/28166f431aa421d976a6f6629e79c0c7e651a036))
* write speaker notes in the editor and over MCP ([#135](https://github.com/zyx1121/slide/issues/135)) ([cc40489](https://github.com/zyx1121/slide/commit/cc4048902bebb2270a95998449dacbce4b4bf40c))

## [0.2.0](https://github.com/zyx1121/slide/compare/v0.1.3...v0.2.0) (2026-10-04)


### Features

* apply agents' changes at once, with no suggestions to accept ([#126](https://github.com/zyx1121/slide/issues/126)) ([9e40051](https://github.com/zyx1121/slide/commit/9e4005171a1492f0bb3c49ea6b9d2cb5054054cc))
* comment on a selection so agents can edit in batches ([#121](https://github.com/zyx1121/slide/issues/121)) ([c4edcfa](https://github.com/zyx1121/slide/commit/c4edcfaa1c9a1974c2bfe39850cc46c07c32a007))
* float the selected shapes' menu next to them ([#129](https://github.com/zyx1121/slide/issues/129)) ([f96766e](https://github.com/zyx1121/slide/commit/f96766ea3554e40e51b4247198de4ca292bc473d))
* give every editor action an MCP tool, review included ([#120](https://github.com/zyx1121/slide/issues/120)) ([cdd4d8a](https://github.com/zyx1121/slide/commit/cdd4d8acdaef6897282e49432d16d3536cd16d2f))
* issue MCP tokens from Slide instead of relaying Keycloak ([#113](https://github.com/zyx1121/slide/issues/113)) ([2ba8ecd](https://github.com/zyx1121/slide/commit/2ba8ecd844cb9ecdd6f97bf88427b5294b8f1d86))
* let a deck pick its template, plain by default ([#109](https://github.com/zyx1121/slide/issues/109)) ([69cc886](https://github.com/zyx1121/slide/commit/69cc8867703ddc954596f8819c83df89635dd1a6))
* let agents set a slide's title over MCP ([#130](https://github.com/zyx1121/slide/issues/130)) ([3a545f7](https://github.com/zyx1121/slide/commit/3a545f79da5b9f5d3b57e915bf3947e9916bb19a))
* record deck actions in the history and make deleting undoable ([#119](https://github.com/zyx1121/slide/issues/119)) ([7547ba8](https://github.com/zyx1121/slide/commit/7547ba8a349f36efc12ffd4648c5dc351d78ba53))
* sign in with any OpenID Connect provider, behind an email allowlist ([#112](https://github.com/zyx1121/slide/issues/112)) ([29606a7](https://github.com/zyx1121/slide/commit/29606a74cf377762c4e9338574edbf566af7442b))


### Bug fixes

* close the editor edges left after agents' direct edits ([#131](https://github.com/zyx1121/slide/issues/131)) ([7c5535d](https://github.com/zyx1121/slide/commit/7c5535d6d11262c274f02b09cb6d335429a12dde))
* keep 1rem beside every slide, scrollbar or not ([#122](https://github.com/zyx1121/slide/issues/122)) ([afad6eb](https://github.com/zyx1121/slide/commit/afad6eb6840a410ca4714b7a8e167aa07865ed3f))
* refuse a code for a missing member and match redirect URIs parsed ([#115](https://github.com/zyx1121/slide/issues/115)) ([499ba36](https://github.com/zyx1121/slide/commit/499ba3621f7d57a2db759856c20a499158d0fb66))
* round each slide's corners by 1rem in the editor ([#123](https://github.com/zyx1121/slide/issues/123)) ([04515b5](https://github.com/zyx1121/slide/commit/04515b5826023b838c0900f5ef22acc971395938))
* send the mark to Slide's home, all decks ([#124](https://github.com/zyx1121/slide/issues/124)) ([74bbd56](https://github.com/zyx1121/slide/commit/74bbd56d20d723d1c40ceae9d355aac0ccf472bf))

## [0.1.3](https://github.com/zyx1121/slide.winlab.tw/compare/v0.1.2...v0.1.3) (2026-10-04)


### Bug fixes

* buffer at most 2 MB of a request body for the proxy ([#99](https://github.com/zyx1121/slide.winlab.tw/issues/99)) ([c2c3e0d](https://github.com/zyx1121/slide.winlab.tw/commit/c2c3e0dd49e92ecc642481bb26aa4aba1ea0b59e))

## [0.1.2](https://github.com/zyx1121/slide.winlab.tw/compare/v0.1.1...v0.1.2) (2026-10-04)


### Bug fixes

* name suggested edits and the selection on the consent page ([#97](https://github.com/zyx1121/slide.winlab.tw/issues/97)) ([c468779](https://github.com/zyx1121/slide.winlab.tw/commit/c4687796b00fb5121df974bccbd1c70a4d182175))

## [0.1.1](https://github.com/zyx1121/slide.winlab.tw/compare/v0.1.0...v0.1.1) (2026-10-04)


### Bug fixes

* cap the bodies of unauthenticated OAuth requests ([#93](https://github.com/zyx1121/slide.winlab.tw/issues/93)) ([a1f4ac7](https://github.com/zyx1121/slide.winlab.tw/commit/a1f4ac7eb1903be5eff3ed9b215d5b9a40f88e64))

## 0.1.0 (2026-10-04)


### Features

* add images to slides ([#45](https://github.com/zyx1121/slide.winlab.tw/issues/45)) ([35c59a6](https://github.com/zyx1121/slide.winlab.tw/commit/35c59a62674c8eabe3042e66124c4341604460f5))
* add MCP write tools that land as suggestions ([#60](https://github.com/zyx1121/slide.winlab.tw/issues/60)) ([e081781](https://github.com/zyx1121/slide.winlab.tw/commit/e0817817632b08b2196b169763a80035461454eb))
* add, duplicate, delete and reorder slides in the editor ([#64](https://github.com/zyx1121/slide.winlab.tw/issues/64)) ([48294f9](https://github.com/zyx1121/slide.winlab.tw/commit/48294f99840f5f08ac6ffa069f9ed18d38e502a8))
* bent arrows, summing junctions and flipped presets ([#84](https://github.com/zyx1121/slide.winlab.tw/issues/84)) ([ff935a6](https://github.com/zyx1121/slide.winlab.tw/commit/ff935a62bdf807a8ee4c6bfbca986cbd0fcfc5cd))
* check a deck against WinLab rules ([#48](https://github.com/zyx1121/slide.winlab.tw/issues/48)) ([00f96e5](https://github.com/zyx1121/slide.winlab.tw/commit/00f96e58ab121138b5c5866cb36a0b147fbd89c2))
* create, rename and delete decks on the home page ([#29](https://github.com/zyx1121/slide.winlab.tw/issues/29)) ([eec3c75](https://github.com/zyx1121/slide.winlab.tw/commit/eec3c7572af08f0460bb103e59924e9ee4d27ee9))
* define the deck document and the single mutation path ([#22](https://github.com/zyx1121/slide.winlab.tw/issues/22)) ([6b5f5ca](https://github.com/zyx1121/slide.winlab.tw/commit/6b5f5cabec7f709754603d81de8d32d7a8c84d2f))
* draw connectors and glue their ends to shapes ([#44](https://github.com/zyx1121/slide.winlab.tw/issues/44)) ([e320377](https://github.com/zyx1121/slide.winlab.tw/commit/e32037799bb14ebd190933c4ca2361ee9276efa8))
* edit text in shapes, text boxes and the title ([#43](https://github.com/zyx1121/slide.winlab.tw/issues/43)) ([68f60a0](https://github.com/zyx1121/slide.winlab.tw/commit/68f60a045fb78009928d9bed5fb94506384915f5))
* export a deck to .pptx ([#46](https://github.com/zyx1121/slide.winlab.tw/issues/46)) ([0fe6408](https://github.com/zyx1121/slide.winlab.tw/commit/0fe640826de8eea283f2ed857d863fbf42080775))
* import a freeform of one straight segment as a line ([#73](https://github.com/zyx1121/slide.winlab.tw/issues/73)) ([08f5eeb](https://github.com/zyx1121/slide.winlab.tw/commit/08f5eebffe93efd90267769ae5851a2e71ae1ff9))
* import an uploaded .pptx into a deck ([#49](https://github.com/zyx1121/slide.winlab.tw/issues/49)) ([491472b](https://github.com/zyx1121/slide.winlab.tw/commit/491472b89de697fbf5e8e4b2d8ef0bd8b402a803))
* import arrows, brackets and other presets as shapes ([#67](https://github.com/zyx1121/slide.winlab.tw/issues/67)) ([5776a73](https://github.com/zyx1121/slide.winlab.tw/commit/5776a736936ec18818011a910d71629850e286b1))
* import rectangles filled with a picture, such as equations, as pictures ([#82](https://github.com/zyx1121/slide.winlab.tw/issues/82)) ([36ba58b](https://github.com/zyx1121/slide.winlab.tw/commit/36ba58b06347601d43c8eddc0eea580f31e71db1))
* import tables as a rectangle per cell ([#72](https://github.com/zyx1121/slide.winlab.tw/issues/72)) ([05cd621](https://github.com/zyx1121/slide.winlab.tw/commit/05cd621bd24221c29627de9588a948b1437fafdb))
* keep bullet characters ([#83](https://github.com/zyx1121/slide.winlab.tw/issues/83)) ([5e658be](https://github.com/zyx1121/slide.winlab.tw/commit/5e658be3b056f66d0ccd90812d9814668bad10e8))
* keep freeforms as shapes through import, rendering and export ([#74](https://github.com/zyx1121/slide.winlab.tw/issues/74)) ([95eb8c2](https://github.com/zyx1121/slide.winlab.tw/commit/95eb8c2ad5075af5d485b1a39db11d3d55eef71b))
* keep line spacing and space around paragraphs ([#81](https://github.com/zyx1121/slide.winlab.tw/issues/81)) ([2438456](https://github.com/zyx1121/slide.winlab.tw/commit/2438456a9c3fa0ee14fcffafbc83e59426a84162))
* keep picture crops through import, rendering and export ([#66](https://github.com/zyx1121/slide.winlab.tw/issues/66)) ([762475f](https://github.com/zyx1121/slide.winlab.tw/commit/762475f6b417f0831ef153025b18e41f9bdd735e))
* keep pictures padded inside their frames ([#78](https://github.com/zyx1121/slide.winlab.tw/issues/78)) ([0baa810](https://github.com/zyx1121/slide.winlab.tw/commit/0baa810c9822432da73740a6c7bda3afbe00a200))
* keep text that does not wrap, as PowerPoint's wrap="none" ([#76](https://github.com/zyx1121/slide.winlab.tw/issues/76)) ([757f458](https://github.com/zyx1121/slide.winlab.tw/commit/757f458c9702c586bc338a39c2ae73ae079d9323))
* let the slide fill the editor with tools floating over it ([#35](https://github.com/zyx1121/slide.winlab.tw/issues/35)) ([31ebf81](https://github.com/zyx1121/slide.winlab.tw/commit/31ebf81a196e7d7e7a6bf0ca493e549adf4b342d))
* move, resize, and arrange shapes in the editor ([#30](https://github.com/zyx1121/slide.winlab.tw/issues/30)) ([4ee69ab](https://github.com/zyx1121/slide.winlab.tw/commit/4ee69ab725d4408d09389f8387caf1e63270ce7a))
* publish a deck to a public URL ([#47](https://github.com/zyx1121/slide.winlab.tw/issues/47)) ([bfbac17](https://github.com/zyx1121/slide.winlab.tw/commit/bfbac175394e2aa17d2c18cd8afef6f2d4787e46))
* read imported decks in a worker thread with its own limits ([#69](https://github.com/zyx1121/slide.winlab.tw/issues/69)) ([88cd192](https://github.com/zyx1121/slide.winlab.tw/commit/88cd1929b377ef3e45bd426576f203f8bb262e49))
* render a deck document to svg and png ([#24](https://github.com/zyx1121/slide.winlab.tw/issues/24)) ([9624adc](https://github.com/zyx1121/slide.winlab.tw/commit/9624adcb21a1e2d8333dca9378428e7d98261c34))
* review agent suggestions and revert any change ([#61](https://github.com/zyx1121/slide.winlab.tw/issues/61)) ([c2ab975](https://github.com/zyx1121/slide.winlab.tw/commit/c2ab975fc0e01dbcee125aa3a711ba5f9e21e8fe))
* send traces and error logs to Sensorium over OpenTelemetry ([#86](https://github.com/zyx1121/slide.winlab.tw/issues/86)) ([8385917](https://github.com/zyx1121/slide.winlab.tw/commit/83859176f8af5d225b7551a4bd14c647fb76c454))
* serve MCP at /mcp with Keycloak OAuth and read tools ([#58](https://github.com/zyx1121/slide.winlab.tw/issues/58)) ([b92ead1](https://github.com/zyx1121/slide.winlab.tw/commit/b92ead1e761a0049fe4ef8ad0aad5164cc0a450a))
* show the member's selection to their agent ([#62](https://github.com/zyx1121/slide.winlab.tw/issues/62)) ([331fb70](https://github.com/zyx1121/slide.winlab.tw/commit/331fb7062004cc6462b61309b5a6a7cff94c2065))
* show tools for the selected object in the dock ([#40](https://github.com/zyx1121/slide.winlab.tw/issues/40)) ([0a8b623](https://github.com/zyx1121/slide.winlab.tw/commit/0a8b62368a8b6773b71442f36b50afcdbe0973c1))
* sign in with keycloak and gate pages on the session ([#23](https://github.com/zyx1121/slide.winlab.tw/issues/23)) ([ea5b186](https://github.com/zyx1121/slide.winlab.tw/commit/ea5b1866d7e4be4308f192f5e04c5d7dfa93790c))
* span slides across the viewport with 1 rem gutters ([#38](https://github.com/zyx1121/slide.winlab.tw/issues/38)) ([574be47](https://github.com/zyx1121/slide.winlab.tw/commit/574be47f18373f0cb2494f13c1221bd075977c77))
* stack the slides on one scrolling page ([#37](https://github.com/zyx1121/slide.winlab.tw/issues/37)) ([0b88ca1](https://github.com/zyx1121/slide.winlab.tw/commit/0b88ca1973104779a745727bf4c3cb9dcb0e86d2))
* take text PowerPoint shrank to fit at the size it drew it ([#85](https://github.com/zyx1121/slide.winlab.tw/issues/85)) ([efe5ae9](https://github.com/zyx1121/slide.winlab.tw/commit/efe5ae90ef87ba64b1cbb9d1f6fda54638f218f6))
* undo, redo, copy, and paste in the editor ([#31](https://github.com/zyx1121/slide.winlab.tw/issues/31)) ([8f34540](https://github.com/zyx1121/slide.winlab.tw/commit/8f345402a9ccb63a809de2c4facfd2f9d2eb6e81))


### Bug fixes

* align imported paragraphs by their list style's level ([#75](https://github.com/zyx1121/slide.winlab.tw/issues/75)) ([724752e](https://github.com/zyx1121/slide.winlab.tw/commit/724752e6f78cdfdd6323a05ed5b0a17e94ace08c))
* answer 405 to GET and DELETE on /mcp ([#90](https://github.com/zyx1121/slide.winlab.tw/issues/90)) ([1d5998e](https://github.com/zyx1121/slide.winlab.tw/commit/1d5998e9530eedb635411184d9d9db4033f6d494))
* draw curly quotes one em wide in the CJK font, as PowerPoint does ([#70](https://github.com/zyx1121/slide.winlab.tw/issues/70)) ([f82b900](https://github.com/zyx1121/slide.winlab.tw/commit/f82b90082f8993ba8f9f3f3c2dfb670316442d09))
* draw curly quotes wide only in Chinese runs, and mark runs by text ([#80](https://github.com/zyx1121/slide.winlab.tw/issues/80)) ([db947ca](https://github.com/zyx1121/slide.winlab.tw/commit/db947cae18ddde0f88d9ab91dff47a9a982d8071))
* draw no bullet or number on an empty paragraph ([#79](https://github.com/zyx1121/slide.winlab.tw/issues/79)) ([89ba54d](https://github.com/zyx1121/slide.winlab.tw/commit/89ba54d2176b3e327055356d797ffd80075822ea))
* keep an undo whose save was lost, and say when nothing was ([#52](https://github.com/zyx1121/slide.winlab.tw/issues/52)) ([c8c5025](https://github.com/zyx1121/slide.winlab.tw/commit/c8c502542a4ef02651c329575c17f998b9f01b8e))
* match PowerPoint's line pitch, justification, title autofit and emoji ([#55](https://github.com/zyx1121/slide.winlab.tw/issues/55)) ([e5e7538](https://github.com/zyx1121/slide.winlab.tw/commit/e5e75382f36151a7b1583361b975b433a5012c72))
* pick the shapes inside a hollow frame, not the frame ([#77](https://github.com/zyx1121/slide.winlab.tw/issues/77)) ([1c79678](https://github.com/zyx1121/slide.winlab.tw/commit/1c79678f6ba383e52438092e3bd5fdbe880ecfdc))
* say why a stored deck that breaks the schema cannot be edited ([#51](https://github.com/zyx1121/slide.winlab.tw/issues/51)) ([054c797](https://github.com/zyx1121/slide.winlab.tw/commit/054c7972adb21c43e4fa44a8ead4ab93a12a1dc2))
* show cjk member names family name first ([#26](https://github.com/zyx1121/slide.winlab.tw/issues/26)) ([9760b8e](https://github.com/zyx1121/slide.winlab.tw/commit/9760b8e8a61c2dee9ec206b53bc7209b0fc894d8))
* size imported shape text from the presentation and master defaults ([#65](https://github.com/zyx1121/slide.winlab.tw/issues/65)) ([bfca576](https://github.com/zyx1121/slide.winlab.tw/commit/bfca576adde0d85f7919044b111ad83d778f88d3))
* stop the editor flashing on edits and trim its chrome ([#41](https://github.com/zyx1121/slide.winlab.tw/issues/41)) ([fa429cb](https://github.com/zyx1121/slide.winlab.tw/commit/fa429cb538833c346c10442dea9a4d553179a118))
* store an imported deck's pictures only once the whole file is read ([#68](https://github.com/zyx1121/slide.winlab.tw/issues/68)) ([a14dc5d](https://github.com/zyx1121/slide.winlab.tw/commit/a14dc5d21c37163b022b35ca4edb2eb5d6ac9d1c))
* tint and shade imported colors in linear light, as PowerPoint does ([#71](https://github.com/zyx1121/slide.winlab.tw/issues/71)) ([1f85db3](https://github.com/zyx1121/slide.winlab.tw/commit/1f85db33e2cd47bf3b3242cdc69b1cbd9d382f73))


### Performance

* render slides off the request thread, with limits ([#50](https://github.com/zyx1121/slide.winlab.tw/issues/50)) ([bd61981](https://github.com/zyx1121/slide.winlab.tw/commit/bd619811a9569b084e14ecaf418083ac9f2a6b37))

## Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every entry above this line is generated by [Release Please](https://github.com/googleapis/release-please) from the Conventional Commit titles merged into `main`, so editing one by hand only lasts until the next release pull request.
