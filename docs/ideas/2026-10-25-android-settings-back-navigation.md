# Android Settings Back Navigation

- Date: 2026-10-25
- Status: Promoted to development: https://github.com/NoReasonKen/PttChrome/issues/63

## Problem

The user reports that, in the installed Android app, pressing system Back while settings are open does not navigate or close settings. Instead, the app displays “press Back again to exit app.”

## Desired behavior

While settings are open, Back should handle the applicable settings navigation instead of triggering the app exit warning:

1. From a settings submenu, Back returns to the settings main menu.
2. From the settings main menu, Back closes settings and returns to the app screen that was open before settings.

## Research (2026-10-30)

Code reading only: no test run and no device check.

- **Submenu → main menu: done** by 37e5ef91 (settings as a category list). `PrefModal.jsx` registers a back handler through `registerBack` while a category is open and returns to the category list. If Back still fails there on the device, that is a separate bug to reproduce.
- **Main menu → close settings: not done.** On the category list no handler is registered, so Back falls through to the app's exit warning.
- **Likely fix:** while the settings modal is open, also register "close settings" through `App.registerSheetDismiss`, the mechanism the bottom sheets and the comment bar use (`ContextMenu/index.jsx#registerSettingsBack` already wraps it for the category case). A small change, around a dozen lines.
