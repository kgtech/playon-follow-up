# Concessions Inventory System Design
## PlayOn Sports — Staff Software Engineer

**Kenneth Glenn** | February 2025

---

Thank you for the opportunity to discuss the concessions inventory system. Here's a summary of my approach.

---

## Problem

Design a real-time inventory system for high school concession stands that tracks stock across multiple POS terminals, supports offline operation, and reconciles sales when terminals reconnect.

---

## Requirements

| Functional | Non-Functional |
|------------|----------------|
| Track inventory per event | <2 sec real-time broadcast |
| Decrement stock with broadcast to all terminals | 2+ hours offline support |
| Support 4-10 simultaneous POS terminals | Zero transaction loss |
| Offline sales with proportional allocation | 10x burst capacity (halftime) |
| Admin restocking mid-event | No oversell online; bounded offline |
| Immutable audit trail | |

**CAP Trade-off:** Strong consistency online (Redis atomic ops), bounded eventual consistency offline (proportional allocation + LOW_STOCK lockout).

---

## Architecture

**Interactive Diagram:** [github.com/kgtech/playon-follow-up/diagram.jsx](https://github.com/kgtech/playon-follow-up/diagram.jsx)

| Layer | Components |
|-------|------------|
| Clients | POS Terminal (React Native + SQLite), Web/Mobile App |
| Services | Inventory Service, Reconciliation Worker, Refund Worker |
| Data | Redis (real-time counts), PostgreSQL (audit trail), Outbox (refunds) |
| External | Stripe Terminal (offline payments), Stripe API (refunds) |

---

## Key Design Decisions

1. **Redis atomic DECRBY** — Prevents oversell when two terminals compete for last item. Sub-millisecond latency. If Redis fails, terminals flip to offline mode.

2. **Proportional offline allocation** — Each terminal gets `inventory / terminal_count`. LOW_STOCK items (below 10% threshold) blocked from offline sale entirely.

3. **Event sourcing** — Every sale, restock, adjustment is immutable. Current inventory computed from event stream. Full audit trail.

4. **Outbox Pattern for refunds** — Refund intent written to DB in same transaction as conflict detection. Separate worker calls Stripe with idempotency key. Zero lost refunds.

5. **Graceful degradation** — Redis down? Go offline. Overloaded? Backpressure + offline fallback. The terminal's offline capability is the universal safety valve.

---

## Scale & Domain Transfer

**Q: "How do healthcare patterns apply to high school concessions?"**

**Scale:** Patterns I've built handle ~1,200 events/sec. A high school event at peak is 3-4 ops/sec. Redis Pub/Sub is appropriately sized — not proposing Kafka for 10 terminals.

**Stakes:** A $5 hot dog isn't healthcare compliance, but the system properties are identical: durability (don't lose sales), consistency (don't oversell), availability (keep the line moving). Patterns for offline operation and conflict reconciliation are domain-agnostic.

**What I'd adjust:** Simpler monitoring, less redundancy, faster iteration. The architectural bones are the same.

---

## Summary

Real-time inventory sync via Redis + WebSocket, robust offline support with proportional allocation and LOW_STOCK lockout, automatic reconciliation and refunds via Outbox Pattern. Key principle: graceful degradation over hard failure.

I'm excited about bringing this thinking to PlayOn.

---

**Kenneth Glenn**  
[Interactive Diagram](https://github.com/kgtech/playon-follow-up/diagram.jsx)
