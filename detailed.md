# Concessions Inventory System Design
## PlayOn Sports — Staff Software Engineer Interview Follow-Up

**Candidate:** Kenneth Glenn  
**Date:** February 2025

---

Thank you for the opportunity to discuss the concessions inventory system design. I enjoyed the conversation and wanted to share my complete thinking on the problem, including areas we didn't have time to cover in our session.

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

## Requirements Summary

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

---

## Core Entities

| Entity | Key Fields | Purpose |
|--------|------------|---------|
| **Event** | eventId, venueId, lowStockThreshold, status | Container with configurable threshold |
| **InventoryItem** | itemId, eventId, productId, currentQuantity, lowStockFlag | Real-time stock truth |
| **Product** | productId, name, price, category | Shared catalog across events |
| **Terminal** | terminalId, eventId, currentWorkerId, status, offlineAllocation | POS device with logged-in worker |
| **User** | userId, email, phone, role (CUSTOMER/WORKER/ADMIN) | Identity for audit and receipts |
| **Sale** | saleId, terminalId, workerId, customerId, channel, paymentIntentId, status | Transaction with full audit trail |
| **InventoryEvent** | eventType, userId, quantity, reason, timestamp | Immutable audit log |

### Key State Machines

**Terminal Status:**
```
SETUP → ONLINE ←→ OFFLINE
         ↑          │
         └──────────┘
       (on reconnect: trigger reconciliation)
```

**Sale Status:**
```
COMPLETED ← PENDING_SYNC (after offline sync)
    │
    ↓ (inventory unavailable)
REFUNDING → REFUNDED
```

---

## API Overview

### Critical Path APIs

```
# Decrement inventory (online sale)
POST /events/{eventId}/inventory/{itemId}/decrement
  → { success: true, newQuantity: 48 }
  → { success: false, reason: "OUT_OF_STOCK" }

# Batch sync offline sales (on reconnect)
POST /events/{eventId}/sales/batch-sync
  Body: { sales: [{ localSaleId, items, paymentIntentId, createdAt }] }
  → { results: [{ localSaleId, status: "COMPLETED" | "REFUNDING" }] }

# Real-time updates (WebSocket)
WS /events/{eventId}/inventory/subscribe
  → Server pushes: { itemId, currentQuantity, lowStockFlag }
```

### Supporting APIs

```
# Admin restock
POST /events/{eventId}/inventory/{itemId}/restock
  Body: { quantity: 100, userId, reason: "Truck delivery" }

# Get offline allocation (cached by terminal while online)
GET /terminals/{terminalId}/offline-allocation
  → { allocation: { "item-123": 25, "item-456": 0 }, terminalCount: 4 }

# Worker clock-in
POST /terminals/{terminalId}/clock-in
  Body: { workerId }
```

---

## Architecture Overview

The system operates in three modes:

1. **Online Mode** — Real-time inventory via Redis, WebSocket broadcast, immediate sync
2. **Offline Mode** — Local-first with proportional allocation, queued sales, Stripe Terminal for payments
3. **Reconciliation Mode** — Worker service syncs offline sales, resolves conflicts, triggers auto-refunds

### Component Summary

| Layer | Components |
|-------|------------|
| Clients | POS Terminal (React Native + SQLite), Web/Mobile App, Admin Portal |
| Gateway | API Gateway (auth, rate limiting), WebSocket Gateway |
| Services | Inventory Service, Terminal Registry, Order Service, Reconciliation Worker, Refund Worker |
| Cache | Redis Cluster (inventory counts), Redis Pub/Sub (broadcast) |
| Data | PostgreSQL (entities), Event Store (immutable audit), Outbox Table (refund intents) |
| External | Stripe Terminal (offline payments), Stripe API (refunds), Prep Display |

### Interactive Architecture Diagram

I've created an interactive React diagram that walks through the architecture phase-by-phase:

🔗 **[View Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)**

The diagram includes:
- **Base Architecture:** API Gateway, Inventory Service, Redis, PostgreSQL
- **Real-Time Broadcast:** WebSocket Gateway with Redis Pub/Sub fan-out
- **Offline Support:** Terminal local storage, proportional allocation, Stripe Terminal
- **Reconciliation:** Worker services, Outbox pattern for reliable Stripe refunds
- Toggle between **Architecture View** and **Sequence Diagram View**
- Phase-by-phase walkthrough with narration

---

## Key Design Decisions

### 1. Redis for Real-Time Inventory

Redis atomic `DECRBY` with Lua script validation prevents overselling:

```lua
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
    return redis.call('DECRBY', KEYS[1], ARGV[1])
else
    return -1  -- Reject
end
```

Sub-millisecond latency, 100K+ ops/sec. PostgreSQL is the durable audit trail, written asynchronously.

**If Redis fails:** Terminals detect unavailability and flip to offline mode. Redis failure is just another form of "lost connectivity" — terminals already have offline capability.

### 2. Proportional Offline Allocation

```
Terminal goes offline:
  Hot Dogs: 100 in stock → allocation: 25 (can sell up to 25)
  Gatorade: 8 in stock (LOW_STOCK) → allocation: 0 (BLOCKED)
  Nachos: 0 in stock → allocation: 0 (BLOCKED)
```

LOW_STOCK threshold: default 10%, configurable per event at setup.

### 3. Event Sourcing for Audit Trail

Every change is an immutable InventoryEvent: SALE, RESTOCK, ADJUSTMENT, RECONCILIATION, REFUND. Current inventory = sum of all events. Full traceability, point-in-time reconstruction.

### 4. Outbox Pattern for Refunds

When reconciliation can't honor an offline sale:
1. Mark sale REFUND_REQUIRED
2. Write RefundIntent to Outbox (same transaction)
3. Refund Worker polls Outbox, calls Stripe with idempotency key
4. Customer gets automatic refund to original payment method

Zero lost refunds, even during Stripe outages.

---

## Scale & Domain Transfer

**Q: "High school concessions is completely different scale and stakes than enterprise healthcare. How do these patterns apply?"**

**Scale:** The patterns I've built handle ~1,200 events/sec across multiple tenants. A high school event with 10 terminals at 200 sales/minute peak is 3-4 ops/sec. These patterns are appropriately sized — I'm proposing Redis Pub/Sub for a 10-terminal venue, not Kafka.

**Stakes:** A $5 hot dog isn't a healthcare compliance event, but the system properties are identical: durability (don't lose sales), consistency (don't oversell), availability (keep the line moving). The patterns for preventing data loss, handling offline operation, and reconciling conflicts are domain-agnostic.

**What's different:** Healthcare has stricter audit requirements (HIPAA) and longer retention (7 years). Concessions has simpler data, shorter retention (end of season), and lower consequence per failure. I'd adjust implementation complexity accordingly — simpler monitoring, less redundancy, faster iteration. But the architectural bones are the same.

---

## Monitoring & Observability

### Real-Time Dashboards
- Inventory levels per event (LOW_STOCK and OUT_OF_STOCK highlights)
- Terminal status (online/offline count, last heartbeat)
- Sales velocity (per-minute, with halftime spike visualization)
- Reconciliation queue depth

### Alerts
| Condition | Action |
|-----------|--------|
| Terminal offline > 5 min | Notify event admin (WiFi issue?) |
| Reconciliation conflict rate > 5% | Investigate allocation settings |
| Refund queue depth > 10 | Check Stripe integration |
| Redis latency P99 > 50ms | Performance investigation |
| WebSocket connections drop > 20% in 1 min | Connectivity event |

### Distributed Tracing
Trace ID on every sale: Terminal → Inventory Service → Redis → Postgres. Enables debugging "why was this sale slow" or "where did this get stuck."

---

## Prioritization & Roadmap

If shipping in 4 weeks:

### Must Have (Week 1-2)
- Online sales with Redis inventory + Postgres durability
- Real-time broadcast via WebSocket
- Basic terminal registry

### Must Have (Week 3-4)
- Offline mode with proportional allocation
- Batch sync on reconnect
- Admin restock

### Would Drop for v1
- LOW_STOCK lockout (accept more oversell risk initially)
- Automatic refunds (queue for manual processing)
- Velocity-weighted allocation (use simple 1/N)
- Sophisticated monitoring (basic CloudWatch, add dashboards in v2)

**Why this ordering:** Online sales with real-time sync is the core value prop — it solves "schools oversell because terminals don't share state." Offline support is critical for high school venues with unreliable WiFi. Everything else reduces edge cases but doesn't block launch.

---

## Summary

This design provides real-time inventory synchronization across multiple POS terminals using Redis for atomic operations and WebSocket for broadcast, with robust offline support using proportional allocation and LOW_STOCK lockout to bound oversell risk.

The key architectural decisions:
1. **Availability over consistency** for offline operation — a terminal that can't sell is worse than occasional oversell
2. **Event sourcing** for full auditability — every change is immutable and traceable
3. **Outbox Pattern** for reliable Stripe refunds — zero lost refunds, even during outages
4. **Graceful degradation** throughout — Redis down? Go offline. Overloaded? Backpressure. The terminal's offline capability is the universal safety valve.

I'm excited about the opportunity to bring this thinking to PlayOn's ticketing and concessions challenges.

---

**Kenneth Glenn**  
[GitHub: Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)
