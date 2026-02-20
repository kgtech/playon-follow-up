# Concessions Inventory System Design

**PlayOn Sports — Staff Software Engineer Interview Follow-Up**

Kenneth Glenn | February 2025

---

## 📊 Interactive Architecture Diagram

This repo contains an interactive TypeScript + React diagram that walks through the concessions inventory system architecture as a step-by-step walkthrough.

### Features

- **Step-through walkthrough:** Click Next or use ← → arrow keys to trace each hop in the request flow
- **4 phases:** Base Architecture → Online Flow → Offline Flow → Reconciliation
- **5-layer layout:** Presentation, Application, Services, Data, Workers/External
- **Dark / light mode toggle**
- **Show All mode:** View the complete architecture at a glance
- **Phase transition animations** with visual flash on phase change
- **Async + self-action indicators** on both the diagram and step timeline
- **Halo-highlighted active arrows** rendered on top of components for visibility

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm

### Run Locally

```bash
# Clone the repo
git clone https://github.com/kgtech/playon-follow-up.git
cd playon-follow-up

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📁 Project Structure

```
├── diagram.tsx              # Interactive walkthrough diagram (TypeScript)
├── main.tsx                 # React mount
├── index.html               # Entry point
├── index.css                # Tailwind imports
├── package.json             # Dependencies + scripts
├── vite.config.js           # Vite config (base path for GitHub Pages)
├── tailwind.config.js       # Tailwind config
├── postcss.config.js        # PostCSS config
├── eslint.config.js         # ESLint 9 flat config
├── comprehensive.md         # Full system design document (~12 pages)
├── executive-summary.md     # 2-3 page overview for hiring manager
└── README.md                # This file
```

---

## 📄 Design Documents

| Document | Description |
|----------|-------------|
| `executive-summary.md` | 2-3 page overview with architecture, key decisions, roadmap |
| `comprehensive.md` | Full design doc (~12 pages) with entities, APIs, deep dives, monitoring |

---

## 🛠️ Tech Stack

| Category | Tools |
|----------|-------|
| Language | TypeScript, JSX |
| Framework | React 18 |
| Build | Vite 7 |
| Styling | Tailwind CSS, inline `CSSProperties` |
| Linting | ESLint 9 with eslint-plugin-react |
| Rendering | SVG (architecture diagram, arrows, layers) |

---

## 🎯 System Overview

The concessions inventory system provides:

- **Real-time inventory sync** across multiple POS terminals via Redis + WebSocket
- **Offline support** with proportional allocation and LOW_STOCK lockout
- **Automatic reconciliation** when terminals reconnect
- **Auto-refunds** via Stripe when inventory conflicts occur
- **Immutable audit trail** using event sourcing

### Key Design Decisions

1. **Redis atomic DECRBY** — Prevents oversell with sub-ms latency
2. **Proportional offline allocation** — Each terminal gets `inventory / N`
3. **Event sourcing** — Full auditability, point-in-time reconstruction
4. **Outbox Pattern** — Reliable Stripe refunds, zero lost transactions
5. **Graceful degradation** — Offline mode is the universal safety valve

---

## 📜 Scripts

```bash
npm run dev       # Start Vite dev server
npm run build     # Production build to dist/
npm run preview   # Preview production build
npm run audit     # Check production vulnerabilities only (omits dev deps)
```

---

## 📬 Contact

Kenneth Glenn

---

*Thank you for reviewing my system design approach!*