# PttChrome Domain Overview

Use `GLOSSARY.md` for definitions. This overview connects those concepts to existing behavior and the source that establishes it.

## The reader's journey

A reader enters PTT through the Android app or browser version. The home dashboard provides access to favorite and recently visited boards. A board list contains boards; opening a board leads to its article list. Opening an article leads to its body and comments.

An article may have an article reply, which is another article, or comments attached below its body. Both are responses, but their reading and writing experiences differ.

## Content, presentation, and controls

These are separate dimensions of the experience:

- **Content location**: home, a board list, an article list, or an article.
- **Reading experience**: native PTT view, article easy reading, article-list easy reading, or board-list smooth scrolling.
- **Application surface**: Android app or browser version, with mobile layout where enabled.
- **Controls**: mobile title bar, bottom toolbar, More menu, context action menu, comment bar, and key panel.

Mobile layout changes how content and controls are presented. The Android app adds capabilities around the shared reading experience. Neither term implies that an article list and a board list are interchangeable.

## Concrete boundary checks

### Scrolling and selecting are different

In an enhanced scrolling list, the reader can see entries at a different location from PTT's selection. A report that a list returned to the wrong place needs to identify whether the visible reading position moved, the selected entry changed, or both.

### A comment is not an article reply

The bottom toolbar exposes distinct comment and article-reply actions. Typing into the comment bar adds comments to the current article; writing an article reply creates a separate article.

### Comment growth and score growth are different

One new arrow comment increases the comment count without increasing the recommendation score. A push and a boo add two comments with no net score increase. Consequently, the article-list new-recommendation badge cannot be treated as an exact count of new comments. The new-comments marker inside an article uses a separate baseline from the last completed reading.

### Reading an article and marking it read are different

PTT's read marker and PttChrome's record of reaching an article's end describe different facts. Marking an article read does not establish that this copy of PttChrome has a completed-reading baseline for new comments.

### The APK and its reading page have separate versions

The checked-in Android app loads a web page, with a configurable development page source. Its default production page currently belongs to `abccbaandy/PttChrome`. Testing a change in this personal fork requires confirming which reading page the APK is loading; changing local source alone does not change that page.

## Source map

| Concepts | Source |
| --- | --- |
| Board lists and supported variants | `src/js/board_list_parse.js`, `src/js/board_list_session.js` |
| Article lists and their reading modes | `src/js/list_session.js`, `docs/easy-reading-list.md` |
| Article easy reading and accumulated pages | `src/js/easy_reading.js`, `docs/easy-reading.md` |
| Reading position across temporary operations | `src/js/reading_record.js`, `docs/reading-record.md` |
| Comment counts, recommendation scores, and new-content indicators | `src/js/new_comments.js`, `src/js/comment_parse.js` |
| Comment bar and long comments | `src/js/comment_bar.js`, `src/js/long_push_session.js`, `docs/long-push.md` |
| Toolbar actions and article replies | `src/js/mobile_toolbar.js`, `src/components/MobileToolbar/index.jsx` |
| Title bar and home dashboard | `src/js/mobile_app_bar.js`, `src/js/home_dashboard.js` |
| Context action menu | `src/components/ContextMenu/ContextSheet.jsx` |
| Mobile layout | `src/js/mobile_layout.js`, `docs/mobile.md` |
| Native safe mode and its scope | `src/js/pref_storage.js` |
| Android page source and app capabilities | `android/app/src/main/java/io/github/abccbaandy/pttchrome/AppConfig.kt`, `android/app/src/main/java/io/github/abccbaandy/pttchrome/PageSource.kt`, `docs/android-app.md` |

Existing source names such as `post`, `push`, and some uses of `board list` are broader or less consistent than the glossary. Resolve them by the content they refer to. Use the glossary's canonical terms in new explanations and documentation.
