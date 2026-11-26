# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers, delivery teams, and maintainers who need to locate and inspect files in an SVN repository or working copy.

## Product Purpose

A read-only SVN viewer for DeepSeek Harness. Success means users can find a repository file and inspect its contents or change context without leaving the viewer.

## Capabilities and Constraints

### Feature inventory

- Connects to local working copies and SVN repository URLs (`svn://`, `http(s)://`, `file://`); auto-detects kind and latest revision. The folder button next to the address bar picks a local directory without typing (drive → drill down → connect).
- Directory tree: lazy loading; clicking a row expands it and switches the right pane to that directory's file list (collapsing is the triangle's job — a row click never collapses); folder icons; working-copy status dots (M/A/D/?/!); the tree head is a filter box (filters loaded nodes only, no requests); sparse checkouts read from the repository on demand. The root level is flat — no module grouping (removed in 0.3.21).
- Sidebar sections: **Recent** (records only files actually opened, up to 12, 4-row-tall area with internal scrolling, clear button) and **All directories** (flat tree, collapsible section headers; the header's right-side action is "Collapse all"). The tree-top tool row holds the filter box / count / "Collapse directory bar" button.
- Collapsed rail: a 44px icon strip (Directories / Recent). Hovering an icon opens an anchored flyout that stays visible while hovering; clicking an icon expands the sidebar; there is no bottom expand button. Esc closes the flyout without closing the preview.
- File list: size, last-changed revision, author, date.
- Preview: text/code with line numbers, Markdown source, images, PDF; docx/xlsx/pptx layout rendering (xlsx restores merged cells and two-row sticky headers from `!merges`, long cell text clamps to 2 lines with click-for-full-text, plus a "flatten" escape hatch); archives get a download entry.
- History: commit records for any file or directory; click a revision to view that version.
- Blame: per-line revision and author for text files; click a revision to jump to that version.
- Diff: `svn diff` with graded coloring, inline/side-by-side views and prev/next change navigation; without a revision it compares the working copy against BASE.
- Search: filename (whole repository by default, or current directory) and full-text (local working copy only). Details below.
- Export: current directory or file as zip with progress and cancel; single files download directly.
- Read-only: no commit, update, or delete actions.
- Global status bar (kept): read-only connection / repository HEAD / local index / last refresh / WC·CLI.
- Dual theme: follows the host's light/dark tokens.
- Keyboard: roving-tabindex tree navigation (↑↓←→/Home/End/Enter/Space), Ctrl+P search focus, layered Esc; see the keyboard table in `README.md`.

### Host routes (`lib/index.js`, prefix `/dsh-svn`)

| Route | Purpose |
| --- | --- |
| `GET /health` | svn version and availability |
| `GET /context` | process cwd, discovered working copies (URL + revision) |
| `GET /info?root=` | repository or working-copy info |
| `GET /list?root=&path=&rev=` | directory listing with revision, author, working-copy status |
| `GET /file?root=&path=&rev=` | type-dispatched content + metadata (docx/spreadsheet/pptx/pdf/image/text…; `&text=1` forces text extraction) |
| `GET /raw?root=&path=&rev=` | raw bytes (images, PDF, downloads); Range (206), inline, accept-ranges |
| `GET /assets/*` | whitelisted preview libraries (docx-preview, JSZip, SheetJS, pptx-preview) |
| `GET /log?root=&path=&limit=` | commit history |
| `GET /diff?root=&path=&rev=` | diff (graded coloring data) |
| `GET /blame?root=&path=` | per-line blame |
| `GET /status?root=` | working-copy status map |
| `GET /tree?root=&path=` | flat listing for search (local disk walk; remote `svn list -R` or depth-limited walk) |
| `GET /fs?path=` | read-only directory enumeration for the picker (no path → drives; with path → subdirectories + absolute paths) |
| `GET /search?root=&q=&mode=name\|content&path=&cancel=1` | filename/full-text search; without `path` uses the whole-repo index (first call returns `indexing:true`, client polls; `cancel=1` cancels indexing); with `path` filters that directory |
| `GET /export?root=&path=` | directory/file zip export |

### svn wrapper (`lib/svn.js`) and host guards

- `lib/svn.js` wraps the `svn` CLI (`--non-interactive --xml` at call sites): per-call timeout and byte cap, UTF-8 decoding with GBK/GB18030 fallback (Chinese Windows), XML parsing (`list`/`log`/`info`/`status`), file-type classification, path joining that stays inside the root.
- `lib/index.js` adds a concurrency cap of 4 simultaneous svn processes, an in-memory TTL cache, and SVN error-code → HTTP mapping (auth 401, not-found 404, unreachable 502, timeout 504…).
- `TEXT_LIMIT = 2 MB`: text preview truncates beyond this.

### Client slots (`lib/client.js`)

- Registers the `sidebar.panellist` entry (label "SVN", order 40) and the `main` panel keyed `dsh-svn-viewer`.
- The `DEFAULT_ROOT` constant at the top of `lib/client.js` decides the first-connect address (default public example `https://svn.apache.org/repos/asf/poi/trunk`); edit as needed.
- UI state persists to localStorage: connected root + address history, tree width (220–560px, default 320, drag the split bar, double-click to reset), current path/selection/expansion, search mode + scope, context-rail toggle, recent files, tree-rail collapsed state (`treerail`, distinct from the context `rail` key), section fold state (`secs`).

### Search & index cache

- Filename search defaults to the whole repository. Remote repositories build a one-time local index (`svn list -R` → gz cache): large repos measure in the millions of entries / minutes / tens of MB gz; invalidated by HEAD revision; rebuilt after 7 days unused. Cache lives in `dsh-svn-viewer-index/` under the system temp directory (`DSH_SVN_INDEX_DIR` overrides); only the latest copy is kept.
- While indexing: a top progress card (scan count + indeterminate bar + single cancel button). Once built, queries take seconds; "current directory" scope is instant and cancellable.
- Full-text search requires a local working copy: text files ≤ 1 MB, Office (docx/xlsx/pptx) bodies ≤ 8 MB and at most 200 Office files; PDF/images are excluded. Remote roots support filename search only; old hosts fall back to `/tree` for directory-scoped name search.

### Office pipeline

- Host-side text extraction (`lib/office.js`) when available; on old hosts the browser unpacks docx/xlsx/pptx and extracts text in-page.
- Layout rendering in the client: docx-preview (docx), SheetJS (xlsx family, `!merges` restoration), pptx-preview (pptx); libraries served from the `/assets/*` whitelist under `assets/` (third-party licenses included).
- Rendering failure falls back to the extracted text outline.

### Export limits

- New host: directory export capped at 800 files / 120 MB (plan check before packing).
- Old host or browser-side fallback: 300 files / 60 MB, packed in the page (JSZip), progress counted by files.
- Single-file export downloads directly; raw transfer cap 100 MB (`MAX_RAW`).

### Boundaries & known limitations

- Requires a local `svn` executable (TortoiseSVN command-line tools or SlikSVN); credentials come from `%APPDATA%\Subversion`.
- Text preview truncates above 2 MB.
- Full-text search only under a local working-copy root (limits above); remote roots are filename-only.
- Remote directories read on demand (~0.4s each); whole-repo filename search depends on the index — before it is built, only directory-scoped search works.
- Host code changes (`lib/index.js`) require restarting `dsh web`; client changes apply on page refresh.
- Ctrl+P is bound to search focus and overrides the browser print shortcut (known trade-off, open product decision).

### Self-check matrix & commands

Counts re-run at 0.3.25 (2026-11-25):

| Command | Scope | Result |
| --- | --- | --- |
| `node test/suite.mjs` | offline API tests against a self-built fixture repository | 60/60 |
| `node test/dom.mjs` | jsdom full chain (connect → directory → file → preview → history) + UI regressions | 174/174 |
| `node test/render.mjs` | react-dom/server panel rendering | 8/8 |
| `node test/client-smoke.mjs` | client slot registration | 9/9 |
| `node test/office-browser.mjs` | browser-side Office extraction + zip packing | 5/5 |
| `node scripts/check-live.mjs` | live self-check against a running `dsh web` (no GUI token needed) | live probe |

`check-live.mjs` hits `/dsh-svn/*` on the running host (default `http://127.0.0.1:3080`, `DSH_SVN_BASE` overrides) and checks host health, host version (`/context.repos` field), real repository info/listing, name search, docx body extraction and single-file export. On an old host (before restart) it automatically uses the browser-side fallbacks (Office unpacked in page, zip packed in page), so those items still pass; only "host version" FAILs until `dsh web` is restarted.

### Structure

- `lib/index.js` — host half; registers the `/dsh-svn` route prefix.
- `lib/svn.js` — `svn` CLI wrapper + XML parsing + type classification.
- `lib/office.js` — host-side Office text extraction.
- `lib/client.js` — client half; sidebar entry + main panel (React).
- `assets/` — whitelisted preview libraries and their licenses.
- `docs/` — product docs (this file), Chinese product doc, release pipeline, changelog, UI drawing rules.
- `test/`, `scripts/` — self-check suites and the live probe.

## Evidence on Hand

- Feature inventory and product constraints: this document (merged from the former root `PRODUCT.md` and root `README.md`).
- Usage guide with screenshots: root `README.md`.
- Per-release history and verification records: `docs/CHANGELOG.md`.
- UI critique and landing evidence (0.3.13 → 0.3.25): workspace `outputs/svn-viewer-ui-review/20261124-critique-v8/report.html`, sections 12–17.
- Test counts re-run at 0.3.25: suite 60/60, dom 174/174, render 8/8, smoke 9/9, office-browser 5/5.

## Product Principles

- Make repository location and revision context easy to scan.
- Keep navigation and file inspection within one workspace.
- Make read-only actions and search limitations clear.

## Release & logs

- Release pipeline, version rules and verification criteria: [`RELEASE.md`](RELEASE.md) (docs/RELEASE.md).
- Per-release changelog (full history): [`CHANGELOG.md`](CHANGELOG.md) (docs/CHANGELOG.md).