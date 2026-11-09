# Frontend Rendering Performance

This covers everything a user's browser has to download, parse, and paint. Unlike the DB layer, these fixes matter for every user on every load, and several are close to zero-cost.

## Measure first — Core Web Vitals as the shared vocabulary

Three numbers matter for user-perceived speed, and they have industry-standard thresholds — use these, don't invent your own:

| Metric | What it measures | Good | Needs improvement | Poor |
|---|---|---|---|---|
| **LCP** (Largest Contentful Paint) | Time until the biggest visible element renders | ≤2.5s | 2.5-4s | >4s |
| **INP** (Interaction to Next Paint) | Responsiveness to clicks/taps | ≤200ms | 200-500ms | >500ms |
| **CLS** (Cumulative Layout Shift) | Visual stability (things jumping around while loading) | ≤0.1 | 0.1-0.25 | >0.25 |

Tools: Lighthouse (Chrome DevTools or CLI), PageSpeed Insights (real-world CrUX data, not just a lab run), `web-vitals` npm package for real-user monitoring in production. **Lab data (Lighthouse on your machine) and field data (real users, real networks) can disagree significantly — trust field data more for production decisions, lab data for iterating locally.**

## 1. Bundle Size — the app shouldn't ship as one file

**Shape:** shipping the entire application's JS in one bundle means every user downloads and parses code for pages they haven't visited yet — O(total app size) transferred when the actual need is O(current page size).

**Detect:**
```bash
# Next.js — generates a visual breakdown of what's in each bundle
npx @next/bundle-analyzer
# or check .next/analyze output if already configured
```
Look for: a single vendor chunk that's unexpectedly large, a heavy library (moment.js, lodash-full, a whole icon library) imported when only a fraction of it is used, and pages that import something they don't render conditionally.

**Fix:**
```tsx
// ❌ Imported eagerly, even if only shown after a click
import HeavyChart from '@/components/heavy-chart';

// ✅ Code-split — only downloaded when actually needed
import dynamic from 'next/dynamic';
const HeavyChart = dynamic(() => import('@/components/heavy-chart'), {
  loading: () => <ChartSkeleton />,
});
```
```ts
// ❌ Imports the entire lodash bundle for one function
import _ from 'lodash';
_.debounce(fn, 300);

// ✅ Import only what's used — most modern bundlers tree-shake named ESM imports,
// but confirm your bundler actually does this for the specific library (some
// libraries ship CJS-only and defeat tree-shaking regardless of import style)
import debounce from 'lodash/debounce';
```
Next.js App Router already does automatic route-based code splitting — verify it's not being defeated by a giant shared layout that imports everything used anywhere in the app.

**Cost:** free.

## 2. Images — the classic, still the biggest win available

**Shape:** an uncompressed/wrong-format image is pure wasted transfer — often 5-10x larger than it needs to be for zero visual benefit at the size it's actually displayed.

**Fix:**
```tsx
// ❌ Raw <img>, original file size, no responsive sizing, loads even if off-screen
<img src="/hero.png" />

// ✅ next/image — automatic format negotiation (WebP/AVIF where supported),
// responsive sizing, lazy loading below the fold, explicit dimensions to prevent CLS
import Image from 'next/image';
<Image src="/hero.png" alt="..." width={1200} height={600} priority />
// `priority` only for the actual LCP element (usually one image, above the fold) —
// marking everything priority defeats lazy loading entirely.
```
Format choice: **AVIF** compresses better than WebP in most cases but has slightly less universal support and higher encoding time; WebP is the safe modern default; only fall back to JPEG/PNG for compatibility edge cases. Let `next/image` negotiate this automatically rather than hand-picking one format for all browsers.

**Cost:** free (it's a component swap) — the only "cost" is remembering to use it consistently instead of raw `<img>`.

## 3. Fonts — a common invisible layout-shift and blocking-load source

```tsx
// ✅ next/font — self-hosts Google/custom fonts, eliminates the render-blocking
// external font request, and sets font-display automatically to avoid invisible text
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], display: 'swap' });
```
Avoid loading more than 2-3 font weights/styles — each is a separate file. Variable fonts (one file, many weights) are often the better choice if the library supports it.

If font files are still a large share of page weight after this, load `web-fonts.md` (subsetting, axis limits, core/extended split, pixel-diff proof).

## 4. Server Components vs Client Components — don't ship what doesn't need to run in the browser

**Shape:** marking a component `"use client"` when it doesn't need interactivity ships its JS (and its dependencies' JS) to the browser for no reason — every unnecessary client component is bytes that didn't need to be sent.

**Detect:** grep for `"use client"` at the top of components that only render data (no `useState`, `useEffect`, event handlers, or browser-only APIs).

**Fix:** default to Server Components (no directive needed in App Router); add `"use client"` only at the leaf components that actually need interactivity, and pass data down as props rather than making a whole subtree client-side just because one button inside it needs an `onClick`.

**Cost:** free — this is an architectural default, not a migration.

## 5. Waterfalls — sequential data fetching in the render tree

**Shape:** a parent component that fetches data, then renders a child that fetches more data depending on nothing from the parent, creates an unnecessary request waterfall in the browser/server timeline — the same sequential-await problem as the DB layer (see `database-query-optimization.md` §1), just at the component level.

**Fix:** hoist genuinely independent fetches to the same level and fire them together (`Promise.all` in a Server Component, or parallel `useQuery` calls on the client); only nest fetches when the child's fetch input truly depends on the parent's fetch result.

## 6. Loading States — perceived speed is not the same as actual speed

A page that takes 2 seconds to load with no feedback feels slower than one that takes 2.5 seconds with an immediate skeleton/spinner and a clear "something is happening" signal. But the wrong loading pattern can also make things feel slower — a full-screen blocking loader on every navigation resets the user's context and signals "something is wrong" more than "please wait."

**Rule of thumb:** prefer inline/local loading states (a skeleton in the exact spot content will appear) over full-page loaders; prefer optimistic UI (show the expected result immediately, reconcile with the server response) for fast, high-confidence mutations over waiting for a round-trip before showing anything.

## 7. Third-party scripts — the invisible tax

Analytics, chat widgets, ad tags, and A/B testing scripts routinely add hundreds of KB and block rendering if loaded synchronously. Use `next/script` with the appropriate `strategy`:
```tsx
import Script from 'next/script';
<Script src="https://widget.example.com/embed.js" strategy="lazyOnload" />
// strategy options: beforeInteractive (rare, only for critical polyfills),
// afterInteractive (default, most analytics), lazyOnload (defer until idle — chat widgets, etc.)
```

## Complexity/impact cheat-sheet

| Fix | Effort | Typical impact | Cost |
|---|---|---|---|
| Swap `<img>` → `next/image` | Minutes per instance | Often the single biggest LCP win available | Free |
| Code-split a heavy conditional component | Minutes | Reduces initial bundle for pages that don't need it | Free |
| Move an unnecessary `"use client"` to a leaf | Minutes-hours depending on scope | Reduces JS shipped for that subtree | Free |
| Fix a fetch waterfall | Minutes | Removes N sequential round-trips from render | Free |
| Self-host fonts via `next/font` | Minutes | Removes a render-blocking external request, fixes font-related CLS | Free |
