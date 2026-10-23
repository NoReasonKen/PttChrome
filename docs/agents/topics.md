# Topic documentation index

All source paths and commands in this guide are relative to the repository root; Markdown links resolve from this document.

### Topic documentation

Read the corresponding document before changing the listed area or answering the listed operational questions:

| Area | Document |
| --- | --- |
| Local startup | [docs/run-local.md](../run-local.md) |
| Project sources and Origin allowlist constraints | [docs/pttchrome-research.md](../pttchrome-research.md) |
| Deployed Origin rewriting | [docs/origin-rewrite-extension.md](../origin-rewrite-extension.md) |
| Enhancements, preferences, blacklist, floors, comment merging, auto-login, active pitfalls | [docs/enhanced-addon.md](../enhanced-addon.md) |
| Article reading, settling, rendering, chunking, functionMode | [docs/easy-reading.md](../easy-reading.md) |
| List reading contracts and state, list_session.js, command_queue.js, buffer settling | [docs/easy-reading-list.md](../easy-reading-list.md) |
| List-reading design alternatives | [docs/easy-reading-list-research.md](../easy-reading-list-research.md) |
| Server screen protocol and recognition invariants | [docs/pttbbs-screen-protocol.md](../pttbbs-screen-protocol.md) |
| Capture/replay and privacy | [docs/offline-replay-testing.md](../offline-replay-testing.md) |
| Preference sync, Firebase, platform pitfalls | [docs/pref-sync-firestore.md](../pref-sync-firestore.md) |
| Preview add-ons, image hosts, referer rules | [docs/media-preview-addons.md](../media-preview-addons.md) |
| Image preview behavior, easy-reading controls, loading, and regression coverage | [docs/image-preview-research.md](../image-preview-research.md) |
| Official PTT projects and terminal comment formats | [docs/ptt-official-app-research.md](../ptt-official-app-research.md) |
| On-device AI caption pairing | [docs/merge-caption-ai-assist.md](../merge-caption-ai-assist.md) |
| Build tools and dependency selection | [docs/build-modernization.md](../build-modernization.md) |
| Image latency and proxies; reuse existing measurements | [docs/imgur-latency-research.md](../imgur-latency-research.md) |
| Mouse entry points, regions, priority, left exit-strip geometry, native gestures | [docs/mouse.md](../mouse.md) |
| deep_link*.js and external-link navigation, startup scheduling, PWA/APK handlers | [docs/deep-link.md](../deep-link.md) |
| image_upload*.js, API/CORS, insertion, upload overlays | [docs/image-upload.md](../image-upload.md) |
| board_list*.js and term_view board-list branches | [docs/board-list-smooth-scroll.md](../board-list-smooth-scroll.md) |
| long_push*.js, byte boundaries, filtering, no form-feed | [docs/long-push.md](../long-push.md) and protocol section 11.3 |
| term_size.js, setTermFontSize, centering, NAWS, fixed 80 columns | [docs/terminal-size.md](../terminal-size.md) |
| Android installation, on-device testing, APK/web updates and deployment; android/**, android_bridge.js, credential_store.js, boot_site.js | [docs/android-app.md](../android-app.md) |
| Announcement worker and scripts/ptt-announcements.mjs | [docs/ptt-announcement-bot.md](../ptt-announcement-bot.md) |
| Touch, mobile_layout.js, MobileToolbar/AppBar/Sheet, navigation, system back | [docs/mobile.md](../mobile.md) |
| article_search.js, search_history.js, SearchModal | [docs/article-search.md](../article-search.md) |
| board_note_skip.js | [docs/board-note-skip.md](../board-note-skip.md) |
| screen_refresh.js, pull_refresh.js, aid_navigation.refresh, F5 | [docs/screen-refresh.md](../screen-refresh.md) |
| reading_record.js and any feature changing screens or restore anchors | [docs/reading-record.md](../reading-record.md) |
| PTT agent use, agent_tools.js, agent_parse.js, aid_navigation startBoard/startNum | [docs/agent-tools.md](../agent-tools.md) |
| unread_jump.js | [docs/unread-jump.md](../unread-jump.md) |
| command_palette.js and CommandPalette | [docs/command-palette.md](../command-palette.md) |
| home_dashboard.js and HomeDashboard | [docs/home-dashboard.md](../home-dashboard.md) |
| split_reader.js and SplitReader | [docs/split-reader.md](../split-reader.md) |
| Picking/listing articles and blacklist enforcement through list_row_filter.js | [docs/list-row-filter.md](../list-row-filter.md) |
| next_article.js and pull_next_article.js | [docs/next-article.md](../next-article.md) |
| new_comments.js | [docs/new-comments.md](../new-comments.md) |
| article_tools.js and ArticleTools | [docs/article-tools.md](../article-tools.md) |
| message_inbox.js and App.onData message parsing | [docs/message-inbox.md](../message-inbox.md) |
| help_menu.js and HelpMenu | [docs/help-menu.md](../help-menu.md) |
| Android E2E specs and tests/e2e/android | [docs/android-e2e.md](../android-e2e.md) |
| CI failures, required checks, and new CI job ordering | [docs/ci-troubleshooting.md](../ci-troubleshooting.md) |
| tools/ptt-src-screens and screen scenarios | [docs/ptt-src-screens.md](../ptt-src-screens.md) |
| public/sw.js and open_cache.js | [docs/open-cache.md](../open-cache.md) |

For user-provided debug captures, first use `yarn debug:screens` (`scripts/debug-screens.mjs`). Without a timestamp it prints a readable send/log timeline; --from/--to narrow it. A millisecond timestamp prints the screen using the app's TermBuf/AnsiParser through Vite ssrLoadModule and cassette.rows. Keep this parser authoritative: miniature hand-written terminal parsers can misread CUP and create false remnants. Mid-session captures are incomplete before the first full redraw. Covered by `tests/unit/debug_screens.test.js`.

Unfinished handoffs live under `docs/handoff/`, one Markdown file per unfinished feature/fix. Delete that handoff after finishing it; read [docs/handoff/README.md](../handoff/README.md).
