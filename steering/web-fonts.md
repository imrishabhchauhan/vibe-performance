# Web Fonts: Make Them Smaller Without Changing How the Site Looks

This guide is for one job: font files are a large share of what a page downloads, and you want to cut their bytes while the page looks exactly the same. The method is: measure, find what the site really uses, cut each font to that, split it into a small core and an optional extra file, then prove with before/after pixel diffs that nothing changed.

The basics (self-hosting with `next/font`, `font-display`, limiting weights) are already in section 3 of `frontend-rendering-performance.md`. Do not repeat them here. Start there; come back here when the fonts are still heavy after those basics.

## When to use this guide (and when not)

**Use it when**
- the measured font bytes are a big share of page weight (for example, a few hundred KB of fonts on a page that is otherwise under 1 MB), or
- the LCP element is text and the profile or waterfall shows it waiting on a font file, or
- a font ships thousands of glyphs, several variable axes or many OpenType features, and the site uses a small part of them.

**Do not use it when** fonts are small already, the site uses system fonts only, or the slow part is somewhere else (images, JS, the database). Go to `frontend-rendering-performance.md` or `measurement-and-reporting.md` first.

## The rule that governs everything

Any visible change is a regression, unless the owner approves it. Keep `font-display` and the fallback fonts exactly as they are today. Every step below is judged by a pixel diff, not by a feeling.

## Step 1: Measure the current state

Write down, before touching anything:
- per font file: size on disk (as served, so compressed WOFF2 if that is what ships), glyph count, variable axes and their ranges, OpenType features present, whether it carries hinting
- per page: total font bytes downloaded, and which fonts the page preloads

Use the same method both times (same pages, same cache state, same tool), as the measurement rules in `measurement-and-reporting.md` require.

## Step 2: Find what the site actually uses

Search the code, not just the CSS files. Include inline component styles and style props.

- **Characters:** collect every character in the real content (templates, CMS text, translations, user-visible strings in code). Add characters the CSS can create: for example `hyphens: auto` can show a hyphen character (U+2010) that is not in your text.
- **Weights and axis values per font:** include one-off overrides and bold inside italics (a font may be asked for bold italic even if you never wrote it as one rule).
- **OpenType features** that are switched on (`font-feature-settings`, `font-variant-*`, and features the browser applies by default such as ligatures and kerning).
- **Scripts that fall back today:** if CJK text already renders in a system font because the web font never had those glyphs, keep it that way.

## Step 3: Cut each font to what is used

| What to cut | How | Rule |
|---|---|---|
| Characters | Keep the used characters, plus Latin-1 and Latin Extended-A as a safety margin | Leave CJK to system fonts only if that is how it renders today. In the source's own numbers, this step gave the biggest saving. |
| Variable axes | Limit each axis to the range the site uses | Pin an axis to one value only if nothing in the code overrides it. |
| OpenType features | Keep only the enabled ones | Check the font's defaults before dropping any. |
| Hinting | Remove it | Pixel-diff in every browser and OS you support before accepting, because hinting can affect how small text is drawn. |
| Format | Serve WOFF2 | Compressed; the usual choice for web fonts. |

## Step 4: Split each font into a core and an extended file

- **Core file:** ASCII plus the common punctuation (curly quotes, dashes, ellipsis). Preload it.
- **Extended file:** everything else the site uses (accents, symbols). It sits behind `unicode-range` and only loads when a page needs it.
- Each `unicode-range` must list only characters that file really contains. A range that claims more makes the browser download a file that cannot draw the character, and the text falls through to the fallback font.

Browser behavior (MDN): if the page uses no character from a range, that file is not downloaded; if it uses at least one, the whole file is downloaded. So a range that is too wide wastes bytes, and a range that is wrong breaks text.

## Pitfalls

- **A generated fallback face between the core and the extended file.** Some tools and frameworks add an adjusted fallback `@font-face` (size-adjusted system font). Placed in the wrong order it can draw extended characters before the real font arrives. Check the final CSS order and look at it with the network throttled.
- **Reserved Font Names (RFN).** Some open fonts under the SIL OFL declare an RFN. The OFL FAQ treats removing glyphs for web delivery as modification, which normally does not allow keeping the RFN. Read the font's license header, and rename the font internally after subsetting if an RFN is declared. If you are unsure, ask the owner; this is a legal question, not a tooling one.
- **Tool quirks.** Always inspect the generated files: glyph count, axes, features, `name` table. A subset can silently lose a feature or a glyph the page needs.
- **Do not add a build step.** Prefer a small manual script whose output files are committed, plus a note in the repo on when to rerun it (new languages, new characters in content, new weights, new fonts).

## Step 5: Verify with pixel diffs

Screenshot before and after at the same viewport, then diff the images. Pages to include:
- a page with code or monospace text
- a page with italics and bold italics
- a page with accented characters
- components that set their own font settings
- a page with CJK text, if the site has any

Explain every visible difference. Anything not approved by the owner is a regression: fix the cut, do not accept the diff.

## Step 6: Report

Report bytes before and after, per font and per page, taken the same way both times. Example of what this can look like (numbers from the source below, for those specific fonts, not a promise for your site):

| Font | Before | After |
|---|---|---|
| Inter | 337.5 KB | 47.8 KB |
| Lora | 89.3 KB | 40.1 KB |
| Iosevka | 706.2 KB | 17.6 KB |

In that same example, the character subset alone took Inter to 100.0 KB, Lora to 42.0 KB and Iosevka to 71.4 KB, so most of the saving came from that step. A second user reported 1,133 KB down to 106 KB on another site with the same prompt. Cost: free (code and files only). Reversibility: high, because the original font files stay in git history.

## Tools (all checked 2026-11 against the linked docs)

| Tool | What to use it for | Verified detail |
|---|---|---|
| fontTools `pyftsubset` | Subset by character and drop features | `--unicodes=` takes comma or whitespace separated code points or ranges in hex; `--text-file=` reads characters from a file; `--layout-features=` sets the kept features (default list includes `calt`, `ccmp`, `clig`, `curs`, `dnom`, `frac`, `kern`, `liga`, `locl`, `mark`, `mkmk`, `numr`, `rclt`, `rlig`, `rvrn`; `*` keeps all; `+=` and `-=` add or remove); `--no-hinting` drops hinting (docs say fonts can be "sometimes up to 30%" smaller); `--flavor=woff2` outputs WOFF2 and needs the Brotli Python extension; `--name-IDs=` controls which name entries are kept (default 0 to 6) |
| fontTools `varLib.instancer` | Limit variable axes | Documented example: `fonttools varLib.instancer ./NotoSans-VF.ttf wdth=85 wght=400:700` (pins `wdth`, limits `wght` to 400..700); `wght=drop` drops an axis at its default. Run `fonttools varLib.instancer --help` for other CLI flags; they are not listed on the docs page (the options for overlap and font names are documented only as Python parameters) |
| CSS `unicode-range` | Load the extended file only when needed | Forms: `U+26`, `U+0-7F`, `U+0025-00FF`, `U+4??`, comma separated. Default is all characters |
| CSS `font-display` | Keep the loading behavior; do not change it in this work | Values `auto`, `block`, `swap`, `fallback`, `optional` |
| `<link rel="preload" as="font" type="font/woff2" crossorigin>` | Preload the core file | MDN: font preloads need `crossorigin`, even when the font is same-origin, so the preload matches the font's anonymous CORS request |
| SIL OFL FAQ | Decide if a subset must be renamed | Entries 2.5 to 2.8 (webfont optimization and modification) and 5.3 (RFN use). Read the font's own license header too |
| Pixel diff tool of your choice | Prove nothing changed | Not specified by the source. `unverified`: no specific tool was checked for this guide |

## Not worth it when

- Fonts are already a small part of the page (a few tens of KB), or the site uses system fonts.
- The page is not text-heavy at the top and fonts are not near the LCP element.
- The font license is unclear and nobody can decide the rename question.
- The site changes its content or fonts often and nobody will rerun the script. A stale subset breaks new characters.
- The team cannot run pixel diffs. Without proof, this change is a risk, not a saving.

## Sources (all checked 2026-11)

- Shu Ding (@shuding), post of 29 Oct 2026: https://x.com/shuding/status/2115855028737200211 (the prompt and the Inter, Lora, Iosevka numbers). He also warns: do not paste prompts found online into your agent without reading them. The details in this guide come from the owner's brief of that post; the post itself was not re-opened while writing this guide (`unverified` against the live post).
- Vox (@Voxyz_ai), post: https://x.com/Voxyz_ai/status/2116213549424861384 (reported 1,133 KB to 106 KB; `unverified` against the live post, taken from the brief).
- fontTools subset (`pyftsubset`) docs: https://fonttools.readthedocs.io/en/latest/subset/index.html
- fontTools `varLib.instancer` docs: https://fonttools.readthedocs.io/en/latest/varLib/instancer.html
- MDN, `unicode-range`: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range
- MDN, `font-display`: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- MDN, `rel="preload"`: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preload
- SIL Open Font License FAQ: https://openfontlicense.org/ofl-faq/
