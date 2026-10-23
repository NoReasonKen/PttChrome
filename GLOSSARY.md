# PttChrome

PttChrome is a client for reading and interacting with PTT. This glossary names the content and reading experiences users encounter, independently of how they are implemented.

## Language

### Content and places

**PTT**:
The BBS service that provides boards, articles, comments, and a user's logged-in session.
_Avoid_: PttChrome when referring to the service itself.

**PttChrome**:
The application a user uses to access PTT, including its reading enhancements and controls.
_Avoid_: PTT when referring to the client application's behavior.

**Board**:
A named discussion space on PTT containing articles.
_Avoid_: Article, board list.

**Board list**:
A collection of boards or board folders, such as a favorites list or a category listing.
_Avoid_: Article list, unqualified list.

**Article list**:
A collection of article entries belonging to a board, including a search-result listing within that board.
_Avoid_: Board list, unqualified list, feed.

**Article**:
A board entry with an author, title, body, and any comments attached to it.
_Avoid_: Post, thread, page.

**Comment**:
A response attached below an article, with an author, text, and a push, boo, or arrow type.
_Avoid_: Article reply, push when referring to all comment types.

**Article reply**:
A separate article posted in response to another article.
_Avoid_: Comment, unqualified reply.

**Article code (AID)**:
An identifier for an article within its board, independent of the article's current position in a listing.
_Avoid_: Article number, share link.

**Comment count**:
The number of comments in an article, regardless of whether each comment is a push, boo, or arrow.
_Avoid_: Recommendation score, push count.

**Recommendation score**:
An article's net push-minus-boo score; arrow comments do not increase or decrease it.
_Avoid_: Comment count, number of people who commented.

### Reading experiences

**PTT page**:
One terminal-sized portion of the current PTT screen, which may show only part of an article or listing.
_Avoid_: Entire article, browser page, unqualified page.

**Native PTT view**:
A presentation of PTT's current terminal screen with its original grid and page boundaries.
_Avoid_: Android-native interface, entire loaded article.

**Article easy reading**:
The continuous reading view of an article, with its available pages joined together for scrolling.
_Avoid_: Article-list easy reading, native PTT view, unqualified easy reading when the surface matters.

**Image viewer**:
A separate view of an article's images for browsing, zooming, and panning, with a return to the viewed image's reading position.
_Avoid_: Inline preview, article-wide image enlargement, external browser.

**Viewer preload range**:
The neighboring article images selected for preparation around the image currently open in the image viewer.
_Avoid_: Download queue, concurrent load limit.

**Article-list easy reading**:
The continuous scrolling view of article entries within a board or its search results.
_Avoid_: Board-list smooth scrolling, article easy reading, unqualified list mode.

**Board-list smooth scrolling**:
The continuous scrolling view of supported favorites and category board listings.
_Avoid_: Article-list easy reading, scrolling an article.

**Native safe mode**:
A temporary setting that suspends selected PttChrome reading and automatic interaction enhancements while preserving their individual preferences.
_Avoid_: Disabling every client feature, Android safe mode, logging out of PTT.

**Reading position**:
The location the reader is viewing within an article, article list, board list, or home dashboard.
_Avoid_: PTT selection, read marker, screen number.

**PTT selection**:
The entry currently selected by PTT in a menu or listing, which can differ from the content visible at the reader's scrolling position.
_Avoid_: Reading position, text selection, touch location.

**Read marker**:
PTT's indication of an article's read status in an article list.
_Avoid_: Proof that the reader reached the end, new-comments marker.

**New-comments marker**:
The divider separating comments added since the reader last finished that article in this copy of PttChrome.
_Avoid_: Read marker, new-recommendation badge.

**New-recommendation badge**:
The article-list badge showing a positive increase in recommendation score since the reader last finished that article in this copy of PttChrome.
_Avoid_: Exact new-comment count, new-comments marker.

### Application and mobile surfaces

**Android app**:
The installed APK edition of PttChrome, combining the shared reading experience with Android-specific capabilities such as maintaining a background connection.
_Avoid_: Mobile layout, browser version, native PTT view.

**Browser version**:
PttChrome used through a web browser, including its home-screen web-app form.
_Avoid_: Android app, desktop-only version.

**Mobile layout**:
PttChrome's touch-oriented presentation of content and controls, available in both the Android app and the browser version.
_Avoid_: Android app, a separate PTT service.

**Home dashboard**:
PttChrome's home view of favorite boards, recently visited boards, and new-mail information.
_Avoid_: Article list, PTT main menu.

**Mobile title bar**:
The top strip identifying the current board, article, menu, or home dashboard.
_Avoid_: Article header, Android system status bar, bottom toolbar.

**Bottom toolbar**:
The persistent row of mobile controls whose available actions depend on the current PTT content, including the More menu and key panel.
_Avoid_: Comment bar, Android system navigation bar, PTT footer.

**More menu**:
The collection of additional actions opened from the bottom toolbar, including settings and actions relevant to the current content.
_Avoid_: Context action menu, PTT main menu.

**Context action menu**:
The actions for the content at a chosen location, opened by a long press on mobile or a context click on desktop.
_Avoid_: More menu, actions for an unspecified article.

**Comment bar**:
The article easy-reading input area for choosing a comment type and entering its text; on mobile it may remain folded until opened from the bottom toolbar.
_Avoid_: Bottom toolbar, article-reply editor.

**Key panel**:
The mobile controls for PTT keys that a phone keyboard may not provide, together with controls for opening the phone keyboard and arming Ctrl.
_Avoid_: Phone keyboard, bottom toolbar.

**Long comment**:
A composed response that PttChrome sends as multiple PTT comments when it exceeds a single comment's limit.
_Avoid_: Article reply, one indivisible PTT comment.
