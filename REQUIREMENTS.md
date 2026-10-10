# Violet's Storybook — Complete product requirements

This document consolidates the user's confirmed decisions and changes. It is the source-of-truth checklist for the Android implementation. Requirements marked **Confirmed** must not be silently removed from later builds.

## 1. Identity and visual language — Confirmed
- Exact app/display name: `Violet's Storybook` (no chat emoji appended to the app name).
- Private signature: `Violet196`, using the user-supplied `Hurricane-Regular.ttf`, in pale lavender / soft lilac.
- App icon: use the user-supplied open book, compass/star and gold celestial-ring artwork as the source image; preserve its recognizable composition. Prepare Android launcher icon sizes from that artwork; do not substitute a different generated icon without permission.
- Splash screen: gentle, thoughtful opening experience; ivory paper, navy and antique-gold celestial motif, pale-lavender Violet196 signature, optional tagline “A little universe of stories”.
- Default overall style: light reading theme, warm ivory/paper texture, clean whitespace, elegant and calm.
- Do not ship a dark-fantasy theme as a built-in default preset. Users may create/import such a style themselves via CSS.
- The app's visual identity should remain coherent across icon, splash screen, home, story cards, music library and theme studio.

## 2. Story import and storage — Confirmed
- Import entry points: (A) choose a local file, (B) paste text.
- Initial supported formats: HTML/HTM, Markdown/MD, TXT; keep the architecture extensible.
- Story title is required during import and remains editable afterward. Series, characters, cover, summary and tags are optional and may be completed later.
- Suggested flow: select/paste → preview/organize metadata → save.
- Preserve both original imported content and a separate reading/normalized version. Editing the reading version must not overwrite the original source file.
- Provide original source view and original rendered view as distinct concepts; do not conflate source code with rendered HTML.
- Detect/retain local image resources where possible for offline reading.
- Sanitize imported HTML: do not execute arbitrary scripts, event handlers, or unsafe schemes. Do not let untrusted CSS/HTML hide required controls or alter business logic.
- Local-first and offline reading are primary goals.

## 3. Home and story cards — Confirmed
- User-selectable home layouts:
  - Cover cards: user-uploaded cover image, title, series, optional summary/tags and optional reading progress.
  - Text cards: show the card header/title treatment only; do not show a body summary/excerpt. Header appearance can be customized with CSS.
- Header style can be related between card and reader, but each location may have its own layout/size.
- Search by story title, summary, tags and relevant metadata; filter by series and sort stories.
- Story titles are independently editable; changing a metadata title must not blindly replace same-named strings in the body. If the imported HTML has its own title, ask whether to synchronize.
- Show optional chapter/series numbering in the collection UI without overwriting the original chapter title in the body.

## 4. Series, characters and numbering — Confirmed
- Stories, characters and series are independent entities with many-to-many links:
  - one character can appear in many stories;
  - one story can link to multiple characters;
  - a story can belong to a series; uncategorized stories may remain unclassified until later.
- Each series numbers its own stories starting at Chapter 1; multiple series can each have a Chapter 1.
- Reordering within a series updates collection numbering; moving a story to another series assigns numbering within that new series.
- Powerful future-facing model should allow themes and music defaults at global, character, series and individual-story levels.

## 5. Reader — Confirmed
- Render Markdown and HTML; common Markdown includes headings, bold/italic, lists, block quotes, tables and code blocks.
- Support common HTML/CSS styling and images as far as practical, with safe rendering.
- Long-form reading features: table of contents / section navigation, search, reading progress, resume at last position, font size, line height, paragraph spacing and letter spacing controls.
- Reader styles may be customized via CSS, including story title/header, paragraphs, dialogue, block quotes, separators, lists, tables, images and code.
- Provide original source view and original rendered view.

## 6. Editing, autosave and recovery — Confirmed
- Two editing modes: ordinary text editing and source editing (Markdown/HTML). Allow switching between them and previewing.
- Ordinary editor supports correcting typos, rewriting, inserting/deleting/reordering paragraphs and adding story text.
- Do not silently destroy unknown HTML structure when using ordinary editing. Complex visual HTML round-tripping may not be lossless; preserve original source and explain conversion limits.
- Draft autosave is separate from formal save.
- Before formal save, preserve the immediately previous saved version; user may restore that last version. Keep only the most recent previous version to save space; allow clearing it.
- Warn about unsaved edits on exit/close; support undo/redo; confirm destructive history clearing.
- Do not overwrite the original imported file when editing.
- CSS themes also need version history/restore. Editing CSS creates a draft; it does not replace the active theme until explicitly saved/applied.

## 7. Theme Studio and CSS contracts — Confirmed
- Dedicated in-app Theme Studio supports paste CSS, import `.css`, code editing/highlighting, find/replace, undo/redo, basic syntax errors (e.g. unmatched braces), optional formatting, preview, saving, naming, descriptions, rename, duplicate, delete and export.
- Offer manual preview and live preview (with debounce if needed); user can choose in settings.
- Detect/report obvious selector conflicts/overrides where practical.
- Stable CSS class contracts / namespaces should be designed in advance, including:
  - `app-*`: navigation, home, buttons, dialogs, settings;
  - `card-*`: story cards, covers, tags;
  - `reader-*`: reader container and controls;
  - `story-*`: story title, header, paragraphs, quotes and dialogue;
  - `code-*`: code blocks/highlighting;
  - examples `story-header`, `story-title`.
- CSS can change colors, background, fonts, borders, radius, shadow, spacing, cover ratio, labels, buttons, search, dialogs, quotes, tables, images and header decoration. It cannot change save/delete/export logic, audio permissions, or hide required controls.
- Three theme layers:
  1. App-wide theme for home/cards/buttons/settings;
  2. Reading theme for story body and story header;
  3. Combined theme preset bundling app + reader themes.
- App theme is separate from reading theme.
- Reading theme inheritance priority: individual story > series > global default. No local setting means inherit. Individual “do not play music” is an explicit override; similarly, local theme choices should override inherited defaults.
- Manage import, preview, save, rename, apply, delete, restore defaults and backup.
- Default theme is light paper/reading style; no built-in dark-fantasy default.

## 8. Fonts — Confirmed
- Switch among bundled fonts.
- Import legally obtained `.ttf` / `.otf` files; preview, manage and delete imported fonts.
- Font choice can follow a theme recommendation or remain independent of the theme.
- Separate font settings for body, titles and dialogue; adjust font size, line height, letter spacing and paragraph spacing.
- Ensure Chinese glyph coverage, readability and performance.
- Use user-supplied `Hurricane-Regular.ttf` for the pale-lavender `Violet196` signature.

## 9. Backup, restore and export — Confirmed
- Store stories locally; prioritize offline access.
- Full backup should be a ZIP package containing original content, reading version, images/covers, metadata, series/characters/tags, theme configs, and optionally fonts and audio.
- Audio backup may include all media or only story/config data to control package size.
- Export a single story, a CSS theme, or a standalone `.css` file.
- Before restore, inspect the backup and warn about conflicts/overwrites; support recovery after device change or reinstall.
- Do not claim full media backup is complete until binary media and references are verified in the archive.

## 10. Music Library — Confirmed
- Separate Music Library module, alongside Story Collection and Theme Studio.
- Manage local audio files and playable network audio URLs; search, categorize/tag, preview, rename and delete tracks.
- Network links must be tested; ordinary web pages or platform-protected URLs may not be playable. Offline playback of network URLs is not guaranteed.
- For local files, offer copy into the library (stable and backup-friendly, uses space) or reference the original location (saves space, may break if moved).
- A track is stored once and may be reused in many playlists, characters, series and stories.
- Custom playlists: create/name/describe/manage, optional cover, drag-reorder songs; examples may include “雨夜氛围”, “未寄出的信”, “霍格沃茨日常” and character theme playlists.
- Support two music-association entry points: select tracks/playlists from story settings, and associate a track/playlist with a character, series or story directly from Music Library.
- One story may use multiple tracks, played sequentially in playlist order.
- Playlist association offers both modes:
  - Fixed track list: copy the playlist's current track references/order into a story-specific list; later playlist edits do not alter that story's list, and the story can be reordered independently.
  - Dynamic playlist link: story follows the playlist's track membership and order when it changes.
- The same track may appear in multiple playlists without duplicating the media file.
- After drag-reordering, auto-save the new order; no extra Save click required. Give lightweight save feedback and preserve pending changes if saving fails.
- After reordering during playback, keep the currently playing track running; subsequent tracks follow the new order. Do not restart the current track just because a later item moved.
- Default loop is the current story's own music list, not all tracks in the library. Play the story list in order; after the final track, return to that story list's first track when list-loop is enabled.
- Per-story loop options may include list loop and stop-at-end; global default loop is enabled.
- A story may explicitly choose no music and stop inheriting parent defaults.
- Music inheritance priority: individual story > series > selected character > global default. If a story has multiple linked characters, user can choose which character's default music to inherit.
- When switching stories: if both stories use the same track, continue from current playback position; if the next story has different music, switch to its configured music. If the next story explicitly disables music, stop playback.
- Small floating minimalist music-symbol button, expandable compact panel; not placed in the story header. User may later drag, collapse or hide it.
- Player controls: play/pause, previous/next, progress, volume, collapse/expand. Player appearance can be styled via CSS.
- Default player icon is the minimalist music symbol; no extra player image is required. CSS may optionally decorate with waveforms or geometric record motifs.
- Browser/Android autoplay policies may require a user gesture; show a play control rather than claiming autoplay succeeded.
- Native Android foreground/background/lock-screen playback and audio focus need implementation/testing; CSS must not bypass platform restrictions.

## 11. UI and data safety — Confirmed
- Responsive for Android phone and tablet.
- Autosave drag ordering; show save status/errors.
- Confirm destructive actions (delete story/track/theme, clear history, restore-overwrite, clear all data).
- Never claim success until an operation actually succeeds.
- Avoid silently replacing source data. Preserve recovery options and exportability.

## 12. Current web prototype / build status

The current milestone is a functional, local-first static web app intended for GitHub Pages deployment. The following first-pass capabilities are implemented in the web prototype:

- IndexedDB metadata and binary-media persistence for stories, audio and covers.
- ZIP backup/restore with optional audio, mandatory referenced covers, archive preflight and CRC checks; JSON is metadata-only.
- Story import/edit/read flow with separate source body, common Markdown rendering, progress tracking, draft/history operations and story-cover upload.
- Playlist-specific ordering, fixed and dynamic story associations, inheritance between story/series/selected character/global defaults, loop and autoplay settings.
- Theme editor with CSS import/export, preview, undo/redo, draft storage and reading-style scoping; character/series CRUD and story ordering.
- Defensive HTML/CSS sanitization for imported content and user-edited theme styles.

See `AUDIT_NOTES.md` and `TEST_REPORT.md` for the test evidence and explicit limitations. The automated interaction suite uses a mocked IndexedDB in an isolated browser page; it is not a substitute for testing persistence, real media selection, storage quotas, browser autoplay or offline behavior on the final hosted origin.

A compiled Android `.apk` has **not** been produced. Android SDK/Gradle packaging, app signing, device-specific file permissions, background/lock-screen playback and Android device acceptance tests remain out of scope for this static web delivery. Browser autoplay may require a user gesture. Deploy the contents of this directory to the GitHub Pages repository root so `index.html` is at root, then test backup/restore before importing the full personal archive.
