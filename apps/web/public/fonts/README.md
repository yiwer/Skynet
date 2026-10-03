# Local platform fonts

These unmodified WOFF2 subsets are the same Google Fonts families and weights requested by `prototypes/web-platform`: Geist 400/500/600/700, Geist Mono 400/500, and Noto Serif SC 600. The CSS keeps the original Unicode ranges and `font-display: swap`, so browsers only request the subsets required by visible text.

They are served locally because the production Content Security Policy permits same-origin styles and fonts. Rendering does not depend on access to Google Fonts. `manifest.json` records the source CSS URL, every source font URL, byte length, and SHA-256 at acquisition on 2026-10-03. The family-specific SIL Open Font License notices are included alongside the files.

To update, acquire the same families and weights, preserve Unicode ranges, update the manifest and licenses, and compare rendered text with the prototype under the production CSP before accepting the change.
