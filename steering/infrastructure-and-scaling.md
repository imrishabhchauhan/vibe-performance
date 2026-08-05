# Infrastructure & Scaling

This is where "fast for one user" and "fast for ten thousand concurrent users" diverge. Code-level fixes (query parallelization, caching, bundle size) help every layer, but at real scale, infrastructure shape determines whether the app degrades gracefully or falls over. This file also carries the cost half of "performance and scalability at the lowest possible cost" — the two are the same conversation here, not separate ones.

## The 10x Rule — the core mental model for this file

For every piece of infrastructure, ask: **"what happens at 10x today's load?"** Not "will it work" — specifically, does it degrade gracefully (slower but still correct) or catastrophically (errors, data loss, cascading failure)? This question belongs in the Phase 5 report for every finding in this file.

| Component | Design assumption | 10x scenario | Degrades how? |
|---|---|---|---|
| Fixed DB connection count, no pooler | 20 connections, low concurrency | 200 concurrent requests | Catastrophic — connection errors, requests fail outright |
| Synchronous heavy job (PDF gen, report export) in the request path | 5 requests/minute | 50 requests/minute | Catastrophic — request timeouts pile up, may take the whole service down with them |
| Fixed instance count, no autoscaling | Traffic matches provisioned capacity | Traffic spikes 10x | Degrades to slow/timeouts if there's headroom, catastrophic if there's none |
| Rate limiter scoped per-IP | Individual users behind unique IPs | A school/office behind one NAT'd IP legitimately generates 10x the traffic of an individual | Catastrophic for the wrong reason — blocks a legitimate burst, not an attacker |
| Queue with unbounded concurrency | Low job volume | 10x job volume | Degrades gracefully IF the downstream (DB, third-party API) can also take 10x; catastrophic if not — the queue just moves the bottleneck |

If the answer to "does it degrade gracefully" is "catastrophically" for any load-bearing component, that's an automatic high-severity finding in the report regardless of whether it's causing pain today.

## Connection Pooling (the cross-cutting infra issue)

Already covered in depth in `database-query-optimization.md` §8 — repeating the summary here because it's as much an infra topic as a query topic: **serverless/edge compute + unpooled DB connections is the single most common cause of "works fine until traffic spikes, then everything times out."** Verify pooling (Supavisor/PgBouncer/RDS Proxy) is in front of the DB before diagnosing anything else under a load-related complaint.

## AWS ECS + ALB — request-path shape

**Health checks:** an ALB target group's health check interval and threshold directly determine how fast a bad task gets pulled from rotation vs. how many failed requests users see first. A health check that's too lenient (long interval, high failure threshold) means users hit a dying task for longer than necessary; too aggressive causes flapping (healthy tasks marked unhealthy under normal load spikes). Tune based on your actual startup time and normal latency variance, not defaults copied from a tutorial.

**Task sizing vs. task count:** for CPU/memory-bound work, more smaller tasks (horizontal) generally scales more predictably and fails more gracefully than fewer larger tasks (vertical) — a lost task in a fleet of 10 is a 10% capacity hit; a lost task in a fleet of 2 is a 50% capacity hit. But vertical scaling has less per-task overhead (memory shared for caches, connection pools). There's no universal right answer — state the tradeoff, ask about the actual workload shape before recommending a direction.

**Autoscaling policy:** scale on the metric that actually reflects load for your workload — CPU utilization is right for compute-bound work, but for I/O-bound work (waiting on DB/API calls) CPU can look low while the service is still saturated on concurrent request count. ALB request count per target or a custom CloudWatch metric is often the better trigger for I/O-bound services. **Verify current AWS documentation for ECS Service Auto Scaling before recommending a specific metric/threshold combination** — target tracking policy syntax and available metrics have evolved.

**Deployment safety at scale:** a deployment that swaps all tasks at once creates a capacity gap; rolling deployments with a minimum healthy percent setting avoid this. This is a scaling-safety issue, not just a deploy-speed one.

## Background Jobs & Queues — get synchronous work out of the request path

**Shape:** any request-path work whose duration scales with something other than "this one request" (generating a PDF, sending a batch of emails, processing an uploaded file, calling a slow third-party API) should not block the HTTP response. Doing it synchronously means the request-handling capacity of your whole service is now bounded by the slowest job type, not by your actual request volume.

**Fix pattern (works with QStash, SQS, BullMQ, or any similar queue):**
```ts
// ❌ Request handler blocks until the PDF is fully generated
export async function POST(req: Request) {
  const pdf = await generateLargePdf(data); // could take 10-30s
  return NextResponse.json({ url: await uploadToStorage(pdf) });
}

// ✅ Enqueue immediately, respond fast, do the work async
export async function POST(req: Request) {
  const jobId = await queue.enqueue('generate-pdf', { data });
  return NextResponse.json({ jobId, status: 'processing' }, { status: 202 });
}
// Client polls a status endpoint or receives a webhook/Realtime event when done.
```

**The mass-onboarding edge case (the "10x Rule" applied concretely):** if 500 users can trigger this job type simultaneously (e.g., an institution activates a plan and everyone downloads a report at once), the queue MUST have bounded concurrency downstream, not unbounded fan-out — otherwise you've just moved the synchronous-overload problem from your web tier to your queue worker/third-party API, and it still falls over. Ask explicitly: "what's the largest burst this could realistically see, and does the downstream in the queue path survive that burst?"

**QStash/SQS-specific:** both support retry policies and dead-letter queues — configure them; a job that fails silently with no retry and no DLQ is a data-loss bug waiting to happen, not just a performance issue.

## Rate Limiting — the guardrail that must not block legitimate scale

Every rate limiter needs an answer to three questions before it ships (this generalizes the classic "protect against abuse" instinct into something that survives real usage):
1. **What legitimate burst could trigger this limit?** (a school behind one IP, a power user, a batch import)
2. **Does the error message tell the user what to do next?** ("Too many requests" with no guidance is a dead end)
3. **Is there a higher tier or escalation path for legitimate high-volume users**, rather than a hard wall?

**Scope rate limits per-authenticated-user where possible, not per-IP**, when the traffic source could plausibly be a shared IP (a school, an office, a NAT'd network) — a per-IP limit in that case punishes an entire legitimate institution for normal usage, which reads as a bug from the user's side even though it's "working as designed" from the infra side.

## Cost-Performance Tradeoffs — the explicit math

Every infra recommendation should be able to answer "what does this cost, and what does it buy?" in concrete terms:

| Lever | Cost direction | When it's worth it |
|---|---|---|
| Bigger DB instance / compute tier | Cost ↑, linear-ish | When query optimization (indexes, N+1 fixes) is already done and the bottleneck is genuinely CPU/RAM-bound, not query-shape-bound. Never reach for this first — it's the most expensive lever and often masks a fixable code problem. |
| Add a read replica | Cost ↑ (another instance) | Read-heavy workload where writes are a small fraction of traffic and some replication lag is tolerable |
| Add a CDN / edge cache | Cost ↑ slightly, often near-free at moderate volume | Nearly always worth it for static/public content — very high leverage per dollar |
| Add Redis | Cost ↑ slightly | Only when there's a genuinely expensive, frequently-repeated computation to cache (see `caching-and-data-layer.md`) — don't add it speculatively |
| More ECS tasks (horizontal scale) | Cost ↑ linearly with task count | When load is genuinely higher than current capacity, not when the real problem is inefficient per-request work that horizontal scaling would just paper over |
| A queue for background work | Cost ↑ slightly (queue service + worker compute) | Any user-facing request currently doing slow synchronous work — very high leverage, prevents outages, not just a speed win |

**The anti-pattern to always flag:** throwing more compute/instances at a problem that's actually a code-level inefficiency (an N+1 query, a missing index, sequential awaits). This "fixes" the symptom by paying for more capacity to absorb the waste, and the cost compounds as the user base grows — the inefficiency gets more expensive every month instead of getting fixed once for free. Always check Phase 4's database/frontend layers before recommending a cost-increasing infra change.

## Before any traffic surge (pre-launch scale prep)

If the engagement bucket from `discovery-and-intake.md` is "pre-launch scale prep," the checklist is different from a live-incident fix:
1. Confirm compute tier is sized for the target load, not just current load
2. Confirm connection pooling is in front of the DB
3. Confirm autovacuum (Postgres) is healthy on high-churn tables — bloat degrades performance silently over time even with good indexes
4. Load-test on a quiet period, deliberately, to find the real ceiling — never let the first load test be the actual launch
5. Confirm rate limits are scoped correctly for the expected traffic shape (see above)
6. Confirm background job queues have bounded concurrency and a DLQ
