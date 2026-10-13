# Conversation PDF export

The export opens an options dialog before the native save dialog. Users can choose
the entire conversation or only its latest assistant response, and include or exclude
user attachments. Exporting a latest response includes the preceding prompt's files
when attachments are selected. It does not include that prompt's text.

## Code and data flow

- `js/chat.js` exposes `exportActiveConversationPdf` through the chat command API.
- `js/ui-utilities.js` uses the same flow for the Share menu's PDF action. It extracts
  the selected live thread or saved history viewer's user messages and assistant response content, excluding
  reasoning logs, message actions, and copy buttons. Attachment-only user messages
  are retained when their files are included.
- `js/context-handler.js` identifies the history viewer with its saved session ID and
  attachment metadata. Exporting from history does not fall back to the hidden live
  conversation. The toolbar export also uses history while that viewer is open.
- `js/conversation-pdf-export.mjs` opens the native HTML dialog, selects turns, and
  prepares image previews. Its stylesheet loads on first export, not at app startup.
- `js/conversation-pdf.mjs` builds the self-contained HTML document and exports the
  Electron print options. The header uses a vector version of `assets/icon.png`'s
  four-point star and ring. Local font fallbacks avoid remote font requests.
- The existing `export-conversation-pdf` preload channel passes the HTML and filename
  to `js/main.js`. The main process opens the native save dialog, loads the document
  in a hidden sandboxed window with JavaScript disabled, prints it, saves the PDF,
  and records the recent document. The window is destroyed on success or failure.

No session schema, backend API, live message renderer, or upload/archive format changes
are required. The export uses a snapshot of the visible thread when options open.
Existing text and Markdown sharing remain in the Share menu.

## Attachment behavior

Image attachments are read from the existing local attachment archive when possible.
Otherwise the export tries the preview URL or an available web URL. It embeds a static
preview in the PDF, bounded to 1600 pixels on its longest side. Archive previews have
a 20 MB source limit. Image loading times out after five seconds per image. Temporary
URLs created by the export are revoked without revoking the chat's preview URLs.
Images are prepared one at a time to limit concurrent decoding.

If an image cannot be read, decoded, or accessed under the app's CORS policy, the PDF
keeps its filename and an explicit unavailable-preview notice. Inline response images
also become embedded previews or labeled notices. They remain response content when
user attachments are excluded. Animated images become a static frame.

Documents, audio, video, and other files appear as filenames and MIME types. If their
metadata supplies a valid HTTP or HTTPS URL, they have an "Open original" link. Local
archive paths and storage bucket keys are not turned into public links. Original
document pages, extracted text, and binary files are not embedded in the conversation
PDF. The dialog explains this beside the attachment choice.

Excluding attachments removes the file lists and input image previews and avoids
reading their archive files. An attachment-only user turn is omitted when no files
remain. Selecting the latest response associates only the nearest preceding prompt's
attachments, never older prompts' files.

Saved history stores attachment metadata at session level, without associating each
file with a prompt. These files appear once at the end of an entire-conversation PDF.
They are excluded from latest-response exports because their owning prompt is unknown.

## Layout and printing

The A4 document has a serif title, dark ink, a lime accent, prompt panels, and an
unindented answer column. Prompt whitespace comes only from the user's text. Long
code lines and URLs wrap; table headers repeat; headings avoid separating from their
following content; paragraphs use widow/orphan rules. Entire responses and long code
blocks can span pages rather than being forced onto one page.

Numbered page footers, PDF tags, and heading outlines use Electron's
[printToPDF options](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions).
Text remains selectable, and links remain clickable. The print document is always
light, independently of the app's theme. The options dialog follows the app theme,
supports keyboard focus cycling, Escape, backdrop dismissal, and reduced motion.

Native save cancellation returns to the options dialog with the selection intact.
Save errors appear inline and allow retry. During preparation and saving, controls
are disabled to prevent overlapping exports. Closing the dialog returns focus to the
export trigger.

## Verification

Run the focused checks with:

```powershell
node --test js/tests/conversation-pdf.test.js
```

The tests cover selection, attachment-only prompts, active-thread isolation, the Share
entry point, clipboard behavior, unchanged source DOM, image archive reads, input file
exclusion, document links, filename escaping, cancellation, retry after failure, empty
conversations, keyboard focus, responsive overflow, and both app themes. Browser checks
also load the complete app stylesheet stack to catch integration overrides. The Electron
fixture prints a long rich-content PDF with wrapping code, a multi-page table, a media
preview, repeated headers, selectable text, and numbered footers.

Set `CONVERSATION_PDF_OUTPUT_DIR` to an existing directory to retain test screenshots,
HTML, and the generated PDF. Otherwise test PDFs live in a temporary directory.

On 13 October 2026, all three focused tests passed. The 60 nearby regression checks
for desktop memory, the Electron shell, artifact viewing, native features, and
cross-platform helpers also passed. The shell fixture timed out during the first
concurrent suite run and passed on its standalone rerun. A reconstructed version of
the supplied Jantar Mantar sample was also printed and visually inspected. It fits on
one page with the updated logo and spacing. Its news content is an export sample,
not a fact-check.

A saved-history regression test reproduces the former wrong-conversation export and
verifies the saved prompts, answers, title, filename, and attachments through the real
Electron history renderer. It also covers latest-response export with an empty live
chat, attachment exclusion, toolbar export, and clearing old attachment metadata when
switching saved sessions. A delayed response from a previously opened session is
discarded so its content cannot replace the session currently being exported.
