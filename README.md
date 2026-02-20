# Concessions Inventory System Design

**PlayOn Sports — Staff Software Engineer Interview Follow-Up**

Kenneth Glenn | February 2025

---

## 📊 Interactive Architecture Diagram

This repo contains an interactive React diagram that walks through the concessions inventory system design phase-by-phase.

### Features

- **Phase-by-phase walkthrough:** Base → Real-Time Broadcast → Offline Support → Admin/Audit → Deep Dives
- **Two view modes:** Architecture diagram and Sequence diagram
- **Color-coded swim lanes:** Clients, Gateway, Services, Cache, Data, External
- **Narration:** "Say out loud" guidance for each phase
- **Deep dive highlights:** Components added during deep dives shown with dashed borders

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn

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
├── diagram.jsx          # Main interactive diagram component
├── package.json         # Dependencies (React, Vite)
├── index.html           # Entry point
├── main.jsx             # React mount
└── README.md            # This file
```

---

## 🛠️ Setup Files

If you're starting from just the `diagram.jsx` file, here's the minimal setup:

### package.json

```json
{
  "name": "concessions-inventory-diagram",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0"
  }
}
```

### index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Concessions Inventory System - Architecture Diagram</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.jsx"></script>
  </body>
</html>
```

### main.jsx

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import ConcessionsInventoryDiagram from './diagram.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConcessionsInventoryDiagram />
  </React.StrictMode>,
)
```

### index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.jsx",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### postcss.config.js

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

---

## 📄 Design Documents

This repo also includes written summaries of the system design:

| Document | Description |
|----------|-------------|
| `docs/brief.md` | 1-2 page summary |
| `docs/executive-summary.md` | 2-3 page overview |
| `docs/detailed.md` | 5-7 pages with entities/APIs |
| `docs/comprehensive.md` | Full design doc (~12 pages) |

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

## 📬 Contact

Kenneth Glenn

---

*Thank you for reviewing my system design approach!*
