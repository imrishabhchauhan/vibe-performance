# CPU Hot Loops & Data Layout

This guide is for one narrow case: a profile shows the time is going to the CPU, inside a loop or a data transform, and not to the database, the network or rendering. In that case the fix is often not a smarter cache but a different way to lay out the data. Data-oriented design means arranging data so the loop reads memory in a straight line, instead of chasing pointers and hashing keys.

**Use it only when a profile points here.** In a typical web app, most request time is spent waiting on the database, the network or the browser. Layout tricks do nothing for time spent waiting. If you have not profiled, stop and go to `measurement-and-reporting.md`.

## When to use this guide (and when not)

**Use it when** a CPU profile shows a large share of time in one function or loop, and the code is one of:
- a parser or serializer (CSV, JSON, markdown, custom formats)
- report, PDF or spreadsheet generation
- a large list transform (grouping, sorting, joining, de-duplicating thousands to millions of items in memory)
- a simulation, scoring or ranking loop, a game loop, a layout or graph algorithm

**Do not use it when**
- the request is I/O-bound (the profile is mostly idle or waiting on sockets): go to `database-query-optimization.md` or `infrastructure-and-scaling.md`
- the slow part is independent awaits run one after another: that is a waterfall, not a layout problem (see the `Promise.all` section in `database-query-optimization.md` and section 5 of `frontend-rendering-performance.md`)
- the loop runs on a few hundred items or only once per deploy (cold path)
- the time is in the browser's layout and paint: go to `frontend-rendering-performance.md`

## Step 1: Profile and find the top 5 hot spots

Never guess which loop is hot. Record a profile of a realistic run (real data volume, see the measurement rules in `measurement-and-reporting.md`), then list the 5 slowest spots with the time each one takes.

| Stack | Tool and command | Notes |
|---|---|---|
| Node.js | `node --cpu-prof --cpu-prof-dir=./profiles app.js` | Writes a `.cpuprofile` file on exit. `--cpu-prof-interval` sets the sampling interval in microseconds (default 1000). Open the file in Chrome DevTools (opening `.cpuprofile` there is general knowledge, `unverified` against current DevTools docs). |
| Browser JS | Chrome DevTools, Performance tab: Record, run the action, Stop | The Main section shows a flame chart of main-thread work. Use Capture Settings, CPU slowdown, to test a slower device. |
| Python | `py-spy record -o profile.svg -- python myprogram.py` (flame graph), `py-spy top --pid <pid>` (live view) | On Linux, attaching to a running PID usually needs root; launching through py-spy usually does not. macOS needs root. In Docker add the `SYS_PTRACE` capability. |
| Python (built in) | `python -m cProfile -o output.prof myscript.py`, then read with `pstats` | `cProfile` is an alias of `profiling.tracing`, which documents `-o` and `-s`. The alias form is not shown explicitly in the docs (`unverified`, but the documented `python -m profiling.tracing` takes the same options). |
| Go | `go test -bench=. -cpuprofile=cpu.prof` then `go tool pprof <binary> cpu.prof`, command `top10`; live server: `import _ "net/http/pprof"` then `go tool pprof http://localhost:6060/debug/pprof/profile` | `top10 -cum` style sorting by cumulative time finds the callers that dominate. Note the default 30 second collection window on the live endpoint. |
| Linux native (C, C++, Rust, Zig) | `perf record -g ./app`, then `perf report`; `perf stat` for counters; `perf top` for a live view | `-g` captures call graphs. |

Write the 5 hot spots into the report with the time each takes. A flat profile (no spot above a few percent) means this guide will not help; say so and stop.

## Step 2: Match each hot spot to one case

| Case | How to spot it | Fix | Typical gain | Risk |
|---|---|---|---|---|
| Hash map lookups in a hot loop | Profile shows map or dictionary get/set (hashing, string compare) dominating the loop; keys are small dense integers or can be turned into them | Replace the map with a flat array and use the integer id as the index. Build a one-time id table at the edge (parse time). | Measure it. Depends on key type and data size. | Ids must stay dense and stable. Sparse ids waste memory. Harder to debug than named keys. |
| Pointers or object references between records | Records point to each other (linked lists, trees, parent/child objects); the profile shows time stalled on memory access | Store records in one array and let "pointers" be integer indexes into it | Measure it. Gain comes from memory locality. | Indexes can go stale if records are deleted or moved. Use a free list or tombstones, and test deletion. |
| Many objects, but each pass reads one or two fields | A loop over 100k objects that only touches `x` and `y`, or only `price` | Structure of arrays (SoA): one array per field instead of one array of objects. In JS use TypedArrays (`Float64Array`, `Int32Array`, `Uint8Array`). | Measure it. Largest when a pass reads few fields of wide objects. | Code that needs the whole record gets clumsier. Keep an object view for the cold, readable paths. |
| Array of booleans | `boolean[]` or a list of flags scanned or counted in a loop | Bitset (one bit per flag, packed into integers). In JS use a `Uint32Array` and bit operations. | Measure it. Gain is smaller memory and faster scans and counts. | Bit math is easy to get wrong; wrap it in a tiny tested class. |
| Heap lists that grow per item | The loop appends to many small lists or arrays, and the profile shows allocation and growth (or GC) | Preallocate to the known size (`Vec::with_capacity` in Rust, a sized slice in Go, a sized TypedArray in JS). Where the language supports it, use a small inline-capacity list for lists that are usually tiny (`SmallVec` in Rust). | Measure it. | Over-sizing wastes memory. Inline capacity must match real data; check the length distribution first. |
| Pack hot fields into index bits | Advanced. A hot id is also looked up for a flag or a type on every step | Store the commonly used bits (type, flag) in the upper bits of the integer index so one load answers both questions. Low-level languages only (C, C++, Rust, Zig). | Measure it. | High. Hard to read, easy to break on overflow. Never do this in JS or Python. |
| Independent awaits in series | The profile is idle between calls; code is `await a(); await b();` with no dependency | Not a layout problem. Run them in parallel: see the `Promise.all` section in `database-query-optimization.md`. | Measure it. | Low. |
| Nothing matches | Hot loop, but none of the above fits | Do a data-oriented rewrite of that one loop: write down which fields each pass reads and writes, then group the data by access pattern. Benchmark against the old version before replacing it. | Measure it. | Medium to high. Keep the old version until the benchmark confirms the gain. |

**About caches:** a cache in front of a slow loop hides the slow design; it does not remove it. Redesign the data first. A cache is still right for work that is inherently expensive and repeated (see `caching-and-data-layer.md`, "Before adding a cache").

## Language notes (verified claims only)

- **JS/TS:** TypedArrays (`Uint8Array`, `Int32Array`, `Float64Array`) are fixed-length views over an `ArrayBuffer` (MDN). That makes them the natural tool for SoA, flat tables and bitsets. Contiguous element storage is part of the ECMAScript spec, not stated on the MDN page.
- **Python:** the standard `array` module stores basic values compactly, with a type fixed at creation (Python docs). For heavy numeric work a numeric library is a common choice, but that is outside what was verified for this guide. Python is rarely the right place for micro-layout work; moving the hot loop to a native extension or a vectorized library is usually the bigger win (`unverified`, measure first).
- **Go:** profile with pprof first. The Go GC guide says allocation rate is a major factor in GC frequency and that eliminating heap allocations can give some of the largest improvements. It does not claim that preallocating slices is a fix; measure it.
- **Rust/C/C++/Zig:** `Vec::with_capacity` reserves space so pushes up to that capacity do not reallocate (Rust docs). `SmallVec` keeps a small number of items inline and falls back to the heap for more (smallvec docs). Index-bit packing belongs here and only here.

## Step 3: Report format (per hot spot)

Use this block in the living report, one per spot (see `measurement-and-reporting.md`):

```
Spot N: [function or loop name]
- Time now: [ms or % of the profile, with the benchmark used]
- Case matched: [from the table]
- Files and lines to change: [file:line-range]
- Expected speedup: [a range only if a source or earlier measurement supports it; otherwise "measure it"]
- Cost: free (code only)   Effort: [..]   Reversibility: [..]
- Measured speedup after the approved change: [same benchmark, same data, same machine]
```

Report first, change nothing, wait for approval. Then change one spot at a time and re-run the same benchmark.

## Not worth it when

- The loop is not a top-5 spot, or the profile is flat.
- The code is I/O-bound. Layout changes will not move the number.
- The data is small (hundreds of items). Readable code wins.
- The speedup is under what users can notice and the code gets harder to read. Say so plainly in the report and recommend leaving it.
- The path is cold (runs rarely, or in a background job nobody waits on).
- The team cannot maintain index-based or bit-packed code. Readability has a cost that outlasts the speedup.

## Sources (all checked 2026-11)

- Jarred Sumner (@jarredsumner), post of 2 Nov 2026: https://x.com/jarredsumner/status/2117037940031496252 (his perf-work prompts: data-oriented design, flat arrays with indexes, structure of arrays, inline-capacity lists, bitsets). He works on a low-level runtime; the tricks pay off most there. His "delete all caches" view is stronger than this guide's advice, which is to list caches and flag the ones that hide a slow design.
- Vox (@Voxyz_ai), post of 3 Nov 2026: https://x.com/Voxyz_ai/status/2117342228767281487 (profile first, match each spot to a case, report before changing).
- Node.js CLI docs, `--cpu-prof`, `--cpu-prof-dir`, `--cpu-prof-interval`: https://nodejs.org/api/cli.html
- Chrome DevTools, Performance panel: https://developer.chrome.com/docs/devtools/performance
- py-spy README: https://github.com/benfred/py-spy
- Python `profiling.tracing` (cProfile alias): https://docs.python.org/3/library/profiling.tracing.html
- Python `array` module: https://docs.python.org/3/library/array.html
- Go, "Profiling Go Programs": https://go.dev/blog/pprof
- Go GC guide: https://go.dev/doc/gc-guide
- Linux perf wiki: https://perfwiki.github.io/
- MDN, `Uint8Array` and typed arrays: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array
- Rust std, `Vec`: https://doc.rust-lang.org/std/vec/struct.Vec.html
- smallvec crate docs: https://docs.rs/smallvec/latest/smallvec/
