# Android Settings Back Navigation

- Date: 2026-10-25
- Status: Idea not implemented

## Problem

The user reports that, in the installed Android app, pressing system Back while settings are open does not navigate or close settings. Instead, the app displays “press Back again to exit app.”

## Desired behavior

While settings are open, Back should handle the applicable settings navigation instead of triggering the app exit warning:

1. From a settings submenu, Back returns to the settings main menu.
2. From the settings main menu, Back closes settings and returns to the app screen that was open before settings.
