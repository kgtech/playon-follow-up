# Concessions Inventory System Design
## PlayOn Sports — Staff Software Engineer Interview Follow-Up

**Candidate:** Kenneth Glenn  
**Date:** February 2025

---

Thank you for the opportunity to discuss the concessions inventory system design. I enjoyed the conversation and wanted to share my complete thinking on the problem, including areas we didn't have time to cover in our session.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Requirements](#requirements)
3. [Core Entities & State Machines](#core-entities--state-machines)
4. [API Design](#api-design)
5. [Architecture Overview](#architecture-overview)
6. [Deep Dives](#deep-dives)
7. [Monitoring & Observability](#monitoring--observability)
8. [Prioritization & Roadmap](#prioritization--roadmap)
9. [Scale & Domain Transfer](#scale--domain-transfer)
10. [Summary](#summary)

---

## Problem Statement

Design a real-time concessions inventory system for high school sporting events that:
- Tracks stock per venue/event across multiple POS terminals
- Broadcasts inventory updates in real-time (items go "low" or "out of stock")
- Supports offline terminal operation with reconciliation on reconnect
- Handles burst traffic (halftime rush) without degradation
- Maintains an immutable audit trail for all inventory changes

**Physical Analogy:** Four cash registers at a high school concession stand share a whiteboard showing inventory counts. When Register A sells a Gatorade, someone updates the whiteboard and everyone sees it. If Register B loses WiFi, it gets a "take-home exam" — it can sell up to 25% of whatever was on the whiteboard when it disconnected. But if Gatorade was already marked "LOW," Register B can't sell it offline — too risky. When WiFi returns, Register B turns in its exam for grading and reconciliation.

---

## Requirements

### Functional Requirements

| # | Requirement | Key Detail |
|---|-------------|------------|
| FR1 | Track inventory per venue/event | Each event has isolated inventory; small catalog (tens of items, max ~100) |
| FR2 | Decrement stock with real-time broadcast | All online terminals see updates within 2 seconds; includes LOW_STOCK and OUT_OF_STOCK thresholds |
| FR3 | Support multiple simultaneous POS terminals | 4-10 terminals typical for high school events |
| FR4 | Offline sales with proportional allocation | Offline terminal gets 1/N of last-known inventory; LOW_STOCK items blocked from offline sale |
| FR5 | Admin manual adjustment and restocking | Managers add inventory mid-event; adjustments for spillage/waste with reason codes |
| FR6 | Immutable event-sourced audit trail | Every sale, restock, adjustment persisted; inventory computed from event stream |
| FR7 | Order fulfillment integration | Fire-and-forget to prep/bagging queue |

### Non-Functional Requirements

| NFR | Target | Rationale |
|-----|--------|-----------|
| Real-time latency | <2 sec broadcast | Accurate counts prevent overselling |
| Offline duration | 2+ hours | WiFi at high school stadiums is unreliable |
| Durability | Zero event loss | Financial audit trail required |
| Burst throughput | 10x normal at halftime (~200 TPS/venue) | Predictable rush, must handle it |
| Correctness | No oversell online; bounded oversell offline | Offline caps = inventory / terminal_count |

### CAP Trade-off

**Strong consistency when online, bounded eventual consistency when offline.**

- **Online:** Redis atomic decrements prevent overselling; real-time broadcast keeps terminals synchronized
- **Offline:** Terminals operate on proportional allocation (1/N of inventory); LOW_STOCK items locked out entirely

The LOW_STOCK lockout is a dynamic circuit breaker — when inventory drops below threshold (default 10%, configurable per event), we block offline sales of that item. Online terminals can still sell it (they have real-time truth), but offline terminals skip it.

### Offline Allocation Math

```
Terminal goes offline when:
  - Hot Dogs: 100 in stock (healthy)
  - Gatorade: 8 in stock (LOW_STOCK flag set at 10%)
  - Nachos: 0 in stock (OUT_OF_STOCK)
  
Terminal count: 4

Offline terminal's allocation:
  - Hot Dogs: 100 / 4 = 25 (can sell up to 25)
  - Gatorade: BLOCKED (LOW_STOCK, too risky)
  - Nachos: BLOCKED (OUT_OF_STOCK)
```

### Reconciliation Policy

- **Honor all offline sales if inventory exists**
- **Auto-refund to original payment method** if item physically unavailable
- Refunds processed automatically via Stripe API — no manual intervention

---

## Core Entities & State Machines

### Entity Definitions

| Entity | Key Fields | Purpose |
|--------|------------|---------|
| **Event** | eventId, venueId, name, startTime, endTime, lowStockThreshold (default 10%), status | Container for everything; configurable threshold lives here |
| **InventoryItem** | itemId, eventId, productId, currentQuantity, initialQuantity, lowStockFlag, outOfStockFlag | Real-time source of truth for stock levels |
| **Product** | productId, name, price, category, imageUrl | Catalog item shared across events |
| **Terminal** | terminalId, eventId, name, status, currentWorkerId, lastHeartbeatAt, offlineAllocation | Physical POS device; tracks online/offline state |
| **User** | userId, email, phone, name, role (CUSTOMER/WORKER/ADMIN), authProviderId | Unified identity for audit and receipts |
| **Sale** | saleId, eventId, terminalId, workerId, customerId, items[], totalAmount, paymentIntentId, status, channel, isOfflineSale | Transaction record with payment link for refunds |
| **InventoryEvent** | eventId, inventoryItemId, eventType, quantity, terminalId, saleId, userId, reason, timestamp | Immutable audit log |

### State Machines

**Terminal Status:**
```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
┌──────────┐   heartbeat    ┌──────────┐    heartbeat restored
│  SETUP   │ ─────────────► │  ONLINE  │ ◄─────────────────────┐
└──────────┘                └──────────┘                       │
                                 │                             │
                          no heartbeat                         │
                           for 30 sec                          │
                                 │                             │
                                 ▼                             │
                            ┌──────────┐                       │
                            │ OFFLINE  │ ──────────────────────┘
                            └──────────┘
                                 │
                          on reconnect:
                       trigger reconciliation
```

**Sale Status:**
```
┌─────────────┐      offline sale      ┌──────────────┐
│  COMPLETED  │ ◄───────────────────── │ PENDING_SYNC │
└─────────────┘      after sync        └──────────────┘
      │                                       │
      │ inventory                             │ reconciliation
      │ unavailable                           │ conflict +
      │                                       │ no inventory
      ▼                                       ▼
┌─────────────┐                        ┌─────────────┐
│  REFUNDED   │ ◄───────────────────── │  REFUNDING  │
└─────────────┘    Stripe confirms     └─────────────┘
```

**InventoryItem Flags (Computed):**
```
                    quantity > threshold
┌──────────────┐ ◄──────────────────────── ┌───────────┐
│   HEALTHY    │                           │ LOW_STOCK │
└──────────────┘ ─────────────────────────►└───────────┘
                    quantity ≤ threshold
                           │
                    quantity = 0
                           │
                           ▼
                    ┌─────────────┐
                    │OUT_OF_STOCK │
                    └─────────────┘
```

---

## API Design

### Inventory Management

```
# Get current inventory for event (terminal startup/refresh)
GET /events/{eventId}/inventory
  → { items: [{ itemId, productId, name, price, currentQuantity, 
               lowStockFlag, outOfStockFlag }], terminalCount: 4 }

# Real-time inventory updates (WebSocket subscription)
WS /events/{eventId}/inventory/subscribe
  → Server pushes: { itemId, currentQuantity, lowStockFlag, 
                     outOfStockFlag, timestamp }

# Decrement inventory (online sale)
POST /events/{eventId}/inventory/{itemId}/decrement
  Body: { quantity: 2, terminalId, saleId }
  → { success: true, newQuantity: 48 }
  → { success: false, reason: "OUT_OF_STOCK", availableQuantity: 0 }

# Admin restock
POST /events/{eventId}/inventory/{itemId}/restock
  Body: { quantity: 100, userId, reason: "Truck delivery" }
  → { newQuantity: 150 }

# Admin adjustment
POST /events/{eventId}/inventory/{itemId}/adjust
  Body: { quantity: -5, userId, reason: "Spillage" }
  → { newQuantity: 145 }
```

### Terminal Management

```
# Register terminal for event
POST /events/{eventId}/terminals
  Body: { terminalId, name }
  → { terminalId, offlineAllocation: null }

# Heartbeat (keeps terminal ONLINE, receives terminal count)
POST /terminals/{terminalId}/heartbeat
  → { status: "ONLINE", terminalCount: 4, timestamp }

# Get offline allocation (cached by terminal while online)
GET /terminals/{terminalId}/offline-allocation
  → { allocation: { "item-123": 25, "item-456": 0 }, 
      terminalCount: 4, generatedAt }

# Worker clock-in/out
POST /terminals/{terminalId}/clock-in
  Body: { workerId }
POST /terminals/{terminalId}/clock-out
```

### Sales

```
# Record sale (online)
POST /events/{eventId}/sales
  Body: { terminalId, items: [{ itemId, quantity, unitPrice }], 
          paymentIntentId, workerId, customerId? }
  → { saleId, status: "COMPLETED", totalAmount: 15.00 }

# Batch sync offline sales (on reconnect)
POST /events/{eventId}/sales/batch-sync
  Body: { sales: [{ localSaleId, items, paymentIntentId, createdAt }] }
  → { results: [
        { localSaleId, saleId, status: "COMPLETED" },
        { localSaleId, saleId, status: "REFUNDING", 
          reason: "Item unavailable", refundAmount: 5.00 }
      ]}

# Get sale (for receipt/refund check)
GET /sales/{saleId}
  → { saleId, status, items, totalAmount, refundedAmount?, refundedAt? }
```

### Order Fulfillment (Fire-and-Forget)

```
# Publish order to prep queue
POST /events/{eventId}/orders
  Body: { saleId, items: [{ name, quantity }], orderNumber: "A-042" }
  → { queued: true }
```

### Sync vs. Async Patterns

| Operation | Pattern | Rationale |
|-----------|---------|-----------|
| Inventory decrement | Synchronous (Redis) | Must confirm before completing sale |
| Inventory broadcast | Event-driven (Pub/Sub → WebSocket) | Fire-and-forget to all terminals |
| Offline sale sync | Synchronous batch | Terminal needs per-sale confirmation |
| Refund processing | Event-driven (Outbox → Worker) | Async to Stripe, terminal doesn't wait |
| Order fulfillment | Event-driven (SNS) | Fire-and-forget per requirements |
| Audit trail writes | Event-driven (async) | Non-blocking, eventual persistence |

---

## Architecture Overview

### Component Summary

| Layer | Components |
|-------|------------|
| **Clients** | POS Terminal (React Native + SQLite), Web/Mobile App, Admin Portal |
| **Gateway** | API Gateway (auth, rate limiting), WebSocket Gateway (real-time push) |
| **Services** | Inventory Service, Terminal Registry, Order Service |
| **Workers** | Reconciliation Worker (offline sync), Refund Worker (Stripe refunds) |
| **Cache** | Redis Cluster (inventory counts), Redis Pub/Sub (broadcast) |
| **Data** | PostgreSQL (entities), Event Store (immutable audit), Outbox Table |
| **External** | Stripe Terminal (offline payments), Stripe API (refunds), Prep Display |
| **Message Bus** | SNS/SQS (order fulfillment, async events) |

### Interactive Architecture Diagram

I've created an interactive React diagram that walks through the architecture phase-by-phase:

🔗 **[View Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)**

**Features:**
- Phase selector: Base → FR1+2 (Broadcast) → FR3+4 (Offline) → FR5+6 (Admin/Audit) → Deep Dives
- Toggle between Architecture View and Sequence Diagram View
- Color-coded swim lanes: Clients, Gateway, Services, Cache, Data, External
- Numbered request flows with sync/async distinction
- Deep dive components highlighted with dashed borders
- "Say out loud" narration for each phase

### Request Flows

**Online Sale (Happy Path):**
1. POS Terminal → API Gateway: `POST /inventory/{itemId}/decrement`
2. API Gateway → Inventory Service: Validate + process
3. Inventory Service → Redis: `DECRBY` (atomic)
4. Redis → Inventory Service: New count (or rejection)
5. Inventory Service → PostgreSQL: Write InventoryEvent (async)
6. Inventory Service → Redis Pub/Sub: Publish update
7. WebSocket Gateway → All Terminals: Push new count

**Offline Sale:**
1. Terminal detects no heartbeat response for 30s
2. Flips to OFFLINE mode, uses cached allocation
3. Worker selects item → Terminal checks local inventory
4. If available and not LOW_STOCK → allow sale
5. Decrement local count, store Sale locally (SQLite)
6. Capture payment via Stripe Terminal (encrypted, stored locally)

**Reconciliation (Terminal Reconnects):**
1. Terminal → API: `POST /sales/batch-sync` with offline sales
2. Reconciliation Worker processes chronologically
3. For each: attempt Redis DECRBY
4. If successful → COMPLETED, write InventoryEvent
5. If negative → check for restock; if truly out → REFUND_REQUIRED
6. Write RefundIntent to Outbox (same transaction)
7. Refund Worker → Stripe Refund API (with idempotency key)
8. Update sale to REFUNDED, notify customer

---

## Deep Dives

### Deep Dive 1: Preventing Oversell (Online Concurrency)

**Problem:** Two terminals try to sell the last hot dog simultaneously.

**Options:**

| Approach | How It Works | Pros | Cons |
|----------|--------------|------|------|
| **Good:** DB row locking | `SELECT ... FOR UPDATE` | Simple | Slow, lock contention |
| **Better:** Optimistic locking | Version check on update | No locks held | Retry storms at peak |
| **Best:** Redis atomic DECRBY | Lua script with floor check | Sub-ms, no locks | Redis SPOF |

**Recommendation:** Redis with Lua validation:

```lua
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
    return redis.call('DECRBY', KEYS[1], ARGV[1])
else
    return -1  -- Reject
end
```

**If Redis fails:** Terminals detect unavailability and flip to offline mode. Redis failure = another form of lost connectivity. The terminal's offline capability is the safety valve.

---

### Deep Dive 2: Offline Allocation & Reconciliation

**Problem:** Multiple offline terminals could collectively oversell. Need conflict resolution.

**Allocation Strategy:**
- Proportional: each terminal gets `inventory / terminal_count`
- LOW_STOCK lockout: items below threshold (default 10%) blocked offline
- Terminals preemptively cache allocation while online (every 30 seconds)

**Reconciliation Logic:**

```
FOR each offline sale (chronologically):
  1. Attempt Redis DECRBY
  2. IF successful → COMPLETED, write event
  3. IF negative:
       - Check: did RESTOCK happen after disconnect?
       - IF yes and covers gap → HONOR, adjust
       - IF truly out → REFUND_REQUIRED, write to Outbox
  4. Return result to terminal
```

**Idempotency:** Each offline sale has client-generated UUID. If sync retried (terminal lost connection mid-sync), return cached result — no double-decrements or double-refunds.

---

### Deep Dive 3: Burst Scaling (Halftime Rush)

**Problem:** 10x traffic spike in 15 minutes.

**Strategy: Scheduled Scaling + Backpressure**

**Scheduled Scaling:**
- Event metadata includes `startTime`, `halfTimeEstimate`
- 15 min before halftime: scale Inventory Service 3x
- 30 min after: scale down

**Backpressure:**
- API Gateway: rate limit 10 req/sec per terminal
- If queue depth > threshold: return 429 with Retry-After
- Terminal: exponential backoff, then flip to offline mode

**Why this works:** Graceful degradation > total failure. The terminal's offline capability is the universal safety valve.

---

## Monitoring & Observability

### Real-Time Dashboards

| Dashboard | Metrics |
|-----------|---------|
| Inventory Health | Levels per event, LOW_STOCK highlights, OUT_OF_STOCK count |
| Terminal Status | Online/offline count, last heartbeat per terminal |
| Sales Velocity | Per-minute rate, halftime spike visualization |
| Reconciliation | Queue depth, conflict rate, processing time |

### Alerts

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Terminal offline | > 5 min | Notify event admin |
| Reconciliation conflicts | > 5% rate | Investigate allocations |
| Refund queue depth | > 10 | Check Stripe integration |
| Redis latency P99 | > 50ms | Performance investigation |
| WebSocket drop | > 20% in 1 min | Connectivity event |

### Distributed Tracing

Trace ID on every request: Terminal → API Gateway → Inventory Service → Redis → PostgreSQL

Enables: "Why was this sale slow?" and "Where did this transaction get stuck?"

---

## Prioritization & Roadmap

### 4-Week MVP

**Week 1-2 (Must Have):**
- Online sales with Redis inventory + Postgres durability
- Real-time broadcast via WebSocket
- Basic terminal registry

**Week 3-4 (Must Have):**
- Offline mode with proportional allocation
- Batch sync on reconnect
- Admin restock

**Would Drop for v1:**
- LOW_STOCK lockout (accept more oversell risk)
- Automatic refunds (manual processing via admin portal)
- Velocity-weighted allocation (simple 1/N)
- Sophisticated monitoring (basic CloudWatch only)

**Why this ordering:** Online sales with real-time sync is the core value prop — it solves "schools oversell because terminals don't share state." Offline support is critical for high school venues with unreliable WiFi. Everything else reduces edge cases but doesn't block launch.

### Future Iterations

| Version | Features |
|---------|----------|
| v1.1 | LOW_STOCK lockout, automatic refunds |
| v1.2 | Enhanced monitoring dashboards |
| v2.0 | Velocity-weighted allocation, predictive restocking alerts |

---

## Scale & Domain Transfer

**Q: "High school concessions is completely different scale and stakes than enterprise healthcare. How do these patterns apply?"**

**Scale:** The patterns I've built handle ~1,200 events/sec across multiple tenants. A high school event with 10 terminals at 200 sales/minute peak is 3-4 ops/sec. These patterns are appropriately sized — I'm proposing Redis Pub/Sub for a 10-terminal venue, not Kafka.

**Stakes:** A $5 hot dog isn't a healthcare compliance event, but the system properties are identical:
- **Durability** — don't lose sales
- **Consistency** — don't oversell  
- **Availability** — keep the line moving

The patterns for preventing data loss, handling offline operation, and reconciling conflicts are domain-agnostic.

**What's different:** Healthcare has stricter audit requirements (HIPAA) and longer retention (7 years). Concessions has simpler data, shorter retention (end of season), and lower consequence per failure. I'd adjust implementation complexity accordingly — simpler monitoring, less redundancy, faster iteration. But the architectural bones are the same.

---

## Summary

This design provides real-time inventory synchronization across multiple POS terminals using Redis for atomic operations and WebSocket for broadcast, with robust offline support using proportional allocation and LOW_STOCK lockout to bound oversell risk.

### Key Architectural Decisions

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| Availability over consistency (offline) | Accept bounded oversell | Terminal that can't sell > occasional conflict |
| Event sourcing for audit | Storage cost | Full traceability, point-in-time reconstruction |
| Outbox Pattern for refunds | Complexity | Zero lost refunds, even during Stripe outages |
| Redis for hot path | SPOF risk | Sub-ms latency; offline mode is the failover |

### Design Principles

1. **Graceful degradation** — Redis down? Go offline. Overloaded? Backpressure. The terminal's offline capability is the universal safety valve.

2. **Bounded inconsistency** — We accept that offline terminals might oversell, but we cap how badly via proportional allocation and LOW_STOCK lockout.

3. **Event sourcing** — Every change is an immutable event. Current state is derived. Full audit trail for financial reconciliation.

4. **Idempotency everywhere** — Sale UUIDs, Stripe idempotency keys, cached sync results. Safe retries at every layer.

I'm excited about the opportunity to bring this thinking to PlayOn's ticketing and concessions challenges.

---

**Kenneth Glenn**  
[GitHub: Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)
