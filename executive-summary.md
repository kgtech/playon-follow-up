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

---

## Requirements Summary

### Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | Track inventory per venue/event |
| FR2 | Decrement stock with real-time broadcast to all terminals (<2 sec) |
| FR3 | Support multiple simultaneous POS terminals (4-10 per venue) |
| FR4 | Offline sales with proportional allocation and LOW_STOCK lockout |
| FR5 | Admin manual adjustment and mid-event restocking |
| FR6 | Immutable event-sourced audit trail |
| FR7 | Order fulfillment integration (fire-and-forget to prep queue) |

### Non-Functional Requirements

| NFR | Target |
|-----|--------|
| Real-time sync | <2 seconds for inventory broadcast |
| Offline duration | Support 2+ hours without connectivity |
| Burst throughput | 10x normal load at halftime (~200 TPS/venue) |
| Durability | Zero transaction loss |
| Correctness | No oversell online; bounded oversell offline via caps |

### CAP Trade-off

**Strong consistency when online, bounded eventual consistency when offline.**

Online terminals use Redis atomic operations — if two try to sell the last item, exactly one succeeds. Offline terminals operate on proportional allocation (1/N of inventory) with LOW_STOCK items blocked entirely to limit oversell risk.

---

## Architecture Overview

The system operates in three modes:

1. **Online Mode** — Real-time inventory via Redis, WebSocket broadcast, immediate sync
2. **Offline Mode** — Local-first with proportional allocation, queued sales, Stripe Terminal for payments
3. **Reconciliation Mode** — Worker service syncs offline sales, resolves conflicts, triggers auto-refunds

### Interactive Architecture Diagram

I've created an interactive React diagram that walks through the architecture phase-by-phase:

🔗 **[View Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)**

The diagram includes:
- **Base Architecture:** API Gateway, Inventory Service, Redis, PostgreSQL
- **Real-Time Broadcast:** WebSocket Gateway with Redis Pub/Sub
- **Offline Support:** Terminal local storage, proportional allocation, Stripe Terminal
- **Reconciliation:** Worker services, Outbox pattern for reliable refunds
- **Sequence diagrams** for online sale, offline sale, and reconciliation flows

---

## Key Design Decisions

### 1. Redis for Real-Time Inventory

Redis atomic `DECRBY` operations prevent overselling when multiple terminals compete for the last item. Sub-millisecond latency at 100K+ ops/sec. PostgreSQL serves as the durable audit trail, written asynchronously.

### 2. Proportional Offline Allocation

When a terminal disconnects, it receives `inventory / terminal_count` as its offline budget. LOW_STOCK items (below configurable threshold, default 10%) are blocked from offline sale — too risky.

### 3. Event Sourcing for Audit Trail

Every sale, restock, and adjustment is an immutable event. Current inventory is computable from the event stream, enabling full auditability and point-in-time reconstruction.

### 4. Outbox Pattern for Refunds

When reconciliation detects an oversell that can't be honored, refund intent is written to an Outbox table in the same transaction. A separate Refund Worker processes Stripe refunds with idempotency keys — guaranteeing zero lost refunds even during Stripe outages.

---

## Scale & Domain Transfer

**Q: "High school concessions is completely different scale and stakes than enterprise healthcare. How do these patterns apply?"**

**Scale:** The patterns I've built handle ~1,200 events/sec across multiple tenants. A high school event with 10 terminals at 200 sales/minute peak is 3-4 ops/sec. These patterns are appropriately sized — I'm proposing Redis Pub/Sub for a 10-terminal venue, not Kafka.

**Stakes:** A $5 hot dog isn't a healthcare compliance event, but the system properties are identical: durability (don't lose sales), consistency (don't oversell), availability (keep the line moving). The patterns for preventing data loss, handling offline operation, and reconciling conflicts are domain-agnostic.

**What's different:** Healthcare has stricter audit requirements and longer retention. Concessions has simpler data, shorter retention, and lower consequence per failure. I'd adjust implementation complexity accordingly — simpler monitoring, less redundancy, faster iteration. But the architectural bones are the same.

---

## Prioritization & Roadmap

If shipping in 4 weeks, here's my priority stack:

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

The key architectural decisions — availability over consistency for offline operation, event sourcing for auditability, and the Outbox Pattern for reliable refunds — are battle-tested patterns that scale from high school concession stands to enterprise systems.

I'm excited about the opportunity to bring this thinking to PlayOn's ticketing and concessions challenges.

---

**Kenneth Glenn**  
[GitHub: Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)
