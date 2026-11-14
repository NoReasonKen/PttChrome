# Android keyboard overlay research

## Goal and scope

When the reader opens the phone keyboard from the key panel, keep the bottom
toolbar and reading content at their original positions; let the keyboard cover
the lower part of the screen. Start with easy reading in the installed Android
app, then check the shared mobile layout and native PTT view.

This note records the feasibility research and source baseline for the local
web implementation. No on-device measurement or installation was performed.
The installed APK, loaded page revision, Android version, and WebView version may
differ from the checked-in source; confirm them before attributing phone behavior.

## Source baseline before implementation

- [Android invariant 8](android-app.md) deliberately keeps the WebView size stable
  when the keyboard opens. [MainActivity.kt](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt)
  applies only system-bar/cutout padding to the root, reports the keyboard overlap
  through `reportImeInset`, and consistently returns `WindowInsetsCompat.CONSUMED`.
- [The manifest](../android/app/src/main/AndroidManifest.xml) declares
  `adjustResize`; [the build configuration](../android/app/build.gradle.kts)
  targets API 37. The explicit inset handling matters more than this attribute
  alone when explaining the intended geometry.
- [android_bridge.js](../src/js/android_bridge.js) receives `pttandroid:ime` and
  exposes the native overlap through `androidImeInset()`.
- [pttchrome.jsx](../src/js/pttchrome.jsx), `toggleSoftKeyboard`, changes the hidden
  terminal input `#t` to accept text and synchronously blurs/refocuses it. Ordinary
  taps keep `inputmode="none"`; see [mobile input rules](mobile.md).
- In the same file, `_onVisualViewport` calls
  [mobile_layout.js](../src/js/mobile_layout.js), `keyboardInset`, which takes the
  larger native overlap or visual-viewport loss rather than adding them.
- The page then deliberately moves **both controls and content**:
  `--kb-inset` raises [MobileToolbar.css](../src/components/MobileToolbar/MobileToolbar.css);
  `mobileChromeInsets` includes the keyboard in the bottom inset passed to
  `view.setKeyboardInset` and `--term-bottom-inset`. Thus a toolbar-only CSS change
  would leave the reading area and bottom prompts avoiding the keyboard.
- Search sheets already have a separate route: `overlayKeyboardInset` updates
  `--vv-kb-inset` without changing terminal geometry; see [mobile sheets](mobile.md).
- [mobile_input.android.spec.js](../tests/e2e/android/mobile_input.android.spec.js)
  explicitly expects the toolbar and terminal bottom row above the keyboard.
  Those assertions describe the existing specification, not the requested overlay.

## Android platform choices

| Mechanism | Documented behavior | Fit for this goal |
| --- | --- | --- |
| `adjustResize` | Resizes the window so content is not covered. | Can move a bottom toolbar above the keyboard. |
| `adjustPan` | Pans the window to reveal the focused control. | Does not preserve the original screen position. |
| `adjustNothing` | Neither resizes nor pans the window. | Relevant overlay option, but does not control page code or every WebView behavior. |
| Edge-to-edge plus IME insets | The app chooses how content responds to overlap. | Matches the existing explicit native/page division. |

These adjustment modes are alternatives. The API 30 deprecation of the
`SOFT_INPUT_ADJUST_RESIZE` constant directs apps toward edge-to-edge and IME inset
handling; it does not mean the manifest's `adjustResize` declaration is forbidden.
Official setup guidance still uses that declaration to receive IME insets.
Sources: [window flags](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#SOFT_INPUT_ADJUST_NOTHING),
[keyboard visibility](https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/visibility),
[edge-to-edge setup](https://developer.android.com/develop/ui/compose/system/setup-e2e).

Targeting API 35+ enables edge-to-edge on Android 15+. On Android 16, apps targeting
API 36+ cannot use the former opt-out. API 37 therefore needs an inset-aware design,
not reliance on that opt-out. Sources:
[Views guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge),
[Android 16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-16#edge-to-edge).

## WebView version considerations

Official WebView guidance says M139 introduced IME-driven visual-viewport resizing
for all WebViews. Layout viewport and visual viewport are distinct: a stable native
view size alone does not establish what JavaScript observes. The documented opt-out
intercepts insets and returns consumed insets from the start, retaining the initial
visual viewport. This resembles the current root policy, but its exact effect in
the installed app remains unmeasured.

The same guidance warns that changing from passing insets to consuming them can
leave stale padding. Where native code handles selected inset types, zeroing those
types while forwarding updates is preferred. Opting out also makes the app
responsible for active-input visibility; `scrollIntoView()` may not avoid the
keyboard. Resize listeners must not clear focus and dismiss the keyboard.
Source: [Understand window insets in WebView](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets).

## Implementation direction

Feasibility is supported by the existing native overlay policy. The local prototype
changes the shared page policy: separate keyboard detection and dismissal tracking from
toolbar movement and reading-area avoidance. For the explicit terminal keyboard
action, preserve toolbar/content geometry while keeping ordinary search and comment
inputs, their submit controls, and sheet scrolling reachable through their own
avoidance paths. Do not simply zero the detector: Back dismissal and subsequent
keyboard-button behavior depend on observing the keyboard.

The accepted tradeoff is that lower PTT input prompts, the key panel, and toolbar
controls can be covered until the keyboard is dismissed. [Mobile rules](mobile.md),
geometry regressions and Android input assertions now reflect this direction.
Keep row count and PTT terminal-size reporting stable. The owner accepted the
local implementation after testing it on the phone.

Local validation passed: the two mobile-layout unit files (76 tests), the mobile
toolbar offline specification (12 tests), and the production web build. The new
offline case substitutes native IME events while checking actual article geometry
and reading position. Updated automated Android Chrome/APK assertions have not
been run locally; they remain distinct from the owner's manual phone acceptance.

Future validation must compare geometry before/open/closed, preserve reading
position, cover ordinary forms and Back, and distinguish Android app from browser
version. Verify relevant Android/WebView versions, system navigation modes,
rotation, and multi-window behavior. Android 17 no longer automatically restores
IME visibility after unhandled configuration changes, so rotation needs explicit
attention: [Android 17 behavior changes](https://developer.android.com/about/versions/17/behavior-changes-all).
