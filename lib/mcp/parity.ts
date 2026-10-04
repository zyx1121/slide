// Everything a member can do in the web app, an agent can do over MCP
// (PLAN.md, v0.3). Each server action and API route a member uses maps to
// the tools that do the same; parity.test.ts fails when one is missing.
export const PARITY: Record<string, readonly string[]> = {
  // app/actions.ts
  createDeckAction: ["create_deck"],
  renameDeckAction: ["rename_deck"],
  deleteDeckAction: ["delete_deck"],
  restoreDeckAction: ["restore_deck", "list_decks"],
  // app/decks/[id]/actions.ts
  editDeckAction: [
    "add_shapes",
    "update_shapes",
    "delete_shapes",
    "add_slide",
    "copy_slide",
    "delete_slide",
    "move_slide",
    "rename_deck",
    "set_template",
  ],
  loadDeckAction: ["get_deck"],
  publishDeckAction: ["publish_deck", "unpublish_deck"],
  historyAction: ["list_history"],
  deckStatusAction: ["get_deck", "list_decks"],
  revertAction: ["revert"],
  // The member points at things; the agent reads what they point at.
  selectAction: ["get_selection"],
  commentsAction: ["list_comments"],
  commentAction: ["add_comment"],
  threadAction: ["reply_comment", "resolve_comment", "reopen_comment"],
  // app/api
  "POST /api/assets": ["upload_image"],
  "GET /api/assets/[sha256]": ["get_image"],
  "POST /api/decks/import": ["import_deck"],
  "GET /api/decks/[id]/export": ["export_deck"],
  "GET /api/decks/[id]/slides/[n]": ["render_slide"],
};

/** Routes that are not a member's actions. */
export const NOT_MEMBER_ACTIONS = ["GET /api/health"];
