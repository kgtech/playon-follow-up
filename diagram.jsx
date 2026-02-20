import React, { useState } from 'react';

// ============================================================================
// CONCESSIONS INVENTORY SYSTEM — Step-Through Walkthrough
// Click through each hop in the request flow. Active arrow + components
// highlight, with a description panel explaining each step.
// ============================================================================

// ---------- PHASES (same 4 flows) ----------
const PHASES = [
  { id: 'base',      label: 'Base',           title: 'Core Architecture' },
  { id: 'online',    label: 'Online Flow',    title: 'Real-Time Sales & Broadcast' },
  { id: 'offline',   label: 'Offline Flow',   title: 'Offline Sales & Local Storage' },
  { id: 'reconcile', label: 'Reconciliation', title: 'Sync & Conflict Resolution' },
];

// ---------- STEPS: each hop in the flow ----------
// source/target match component keys; "self" steps highlight one component
const STEPS = {
  base: [
    { source: 'clients',          target: 'gateway',          label: 'Sale Request',   desc: 'POS terminal sends a sale request (item, quantity, terminal ID) to the API Gateway over REST.' },
    { source: 'gateway',          target: 'inventoryService', label: 'Reserve Stock',  desc: 'Gateway routes to Inventory Service to reserve stock before creating the order.' },
    { source: 'inventoryService', target: 'redis',            label: 'DECRBY',         desc: 'Inventory Service atomically decrements the count in Redis. If the value goes below zero, the sale is rejected.' },
    { source: 'inventoryService', target: 'postgres',         label: 'Stock Event',    desc: 'Inventory Service writes a stock_decremented event to PostgreSQL for the durable audit trail.' },
    { source: 'gateway',          target: 'orderService',     label: 'Create Order',   desc: 'Gateway calls Order Service to create the order record now that stock is reserved.' },
    { source: 'orderService',     target: 'postgres',         label: 'Order Event',    desc: 'Order Service writes an order_created event to PostgreSQL. This is async (outbox pattern) for delivery guarantee.', async: true },
  ],
  online: [
    { source: 'inventoryService', target: 'redis',    label: 'Count Updated', desc: 'After the decrement, the new count is available in Redis.' },
    { source: 'redis',            target: 'gateway',  label: 'Pub/Sub',      desc: 'Redis Pub/Sub broadcasts the updated count to the API Gateway.', async: true },
    { source: 'gateway',          target: 'clients',  label: 'WebSocket Push', desc: 'Gateway pushes the new count to all connected terminals via WebSocket. Every POS screen updates in real time.' },
    { source: 'orderService',     target: 'prepQueue', label: 'Send Order',  desc: 'Order Service fires the order to the Prep Queue (fire-and-forget). Kitchen staff see it on their display.', async: true },
  ],
  offline: [
    { source: 'clients', target: null,     label: 'Heartbeat Lost',    desc: 'Terminal detects lost connectivity — no WebSocket heartbeat for 5 seconds. Switches to offline mode.', self: true },
    { source: 'clients', target: null,     label: 'Local Allocation',  desc: 'Terminal sells against its cached proportional allocation (1/N of inventory). LOW_STOCK items are blocked.', self: true },
    { source: 'clients', target: 'stripe', label: 'Capture Payment',   desc: 'Stripe Terminal captures the payment offline — encrypted on device, will process when connectivity returns.' },
    { source: 'clients', target: null,     label: 'Store in SQLite',   desc: 'Sale stored locally in SQLite with a timestamp and terminal ID. This is the offline ledger for reconciliation.', self: true },
  ],
  reconcile: [
    { source: 'clients',          target: 'gateway',          label: 'Batch Sync',     desc: 'Terminal reconnects and sends an array of offline sales to the Gateway as a batch.' },
    { source: 'gateway',          target: 'reconcileWorker',  label: 'Enqueue Job',    desc: 'Gateway hands off to the Reconciliation Worker (background job) to process sales chronologically.' },
    { source: 'reconcileWorker',  target: 'inventoryService', label: 'Attempt Decrement', desc: 'Worker calls Inventory Service to DECRBY in Redis for each offline sale. If count goes negative → conflict.' },
    { source: 'reconcileWorker',  target: 'orderService',     label: 'Trigger Refund', desc: 'For conflicted sales (oversold), Worker calls Order Service to initiate a refund.' },
    { source: 'orderService',     target: 'stripe',           label: 'Issue Refund',   desc: 'Order Service calls Stripe to refund the customer for items that were no longer available.' },
    { source: 'stripe',           target: 'clients',          label: 'Refund Confirmation', desc: 'Stripe pushes a refund confirmation back to the terminal asynchronously.', async: true },
  ],
};

// ---------- THEMES ----------
const THEMES = {
  dark: {
    bg: '#0f172a',
    cardBg: '#1e293b',
    cardBorder: '#334155',
    text: '#f1f5f9',
    textMuted: '#94a3b8',
    textSub: '#cbd5e1',
    accent: '#3b82f6',
    accentGlow: '#3b82f620',
    btnActive: { bg: '#3b82f6', text: '#ffffff', shadow: '0 4px 14px #3b82f640' },
    btnInactive: { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
    btnNav: { bg: '#334155', text: '#f1f5f9' },
    btnNavDisabled: { bg: '#1e293b', text: '#475569' },
    svgBg: '#1e293b',
    layerBgs:    ['#0c4a6e25', '#78350f25', '#14532d25', '#581c8725', '#3730a325'],
    layerLabels: ['#38bdf8', '#fbbf24', '#4ade80', '#c084fc', '#818cf8'],
    arrow:      { sync: '#475569', async: '#7c3aed', active: '#3b82f6', activeGlow: '#3b82f6' },
    labelPill:  { bg: '#334155', text: '#f1f5f9', border: '#475569' },
    comp: {
      clients:  { color: '#38bdf8', bg: '#0c4a6e', text: '#fff' },
      gateway:  { color: '#fbbf24', bg: '#78350f', text: '#fff' },
      service:  { color: '#4ade80', bg: '#14532d', text: '#fff' },
      redis:    { color: '#fb923c', bg: '#7c2d12', text: '#fff' },
      postgres: { color: '#c084fc', bg: '#581c87', text: '#fff' },
      external: { color: '#818cf8', bg: '#3730a3', text: '#fff' },
    },
    stepCard: { bg: '#0f172a', border: '#334155', numBg: '#3b82f6', numText: '#fff' },
    descCard: { bg: '#1e293b', border: '#3b82f6', text: '#e2e8f0', labelBg: '#3b82f6', labelText: '#fff' },
  },
  light: {
    bg: '#f8fafc',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    text: '#0f172a',
    textMuted: '#64748b',
    textSub: '#475569',
    accent: '#2563eb',
    accentGlow: '#2563eb15',
    btnActive: { bg: '#0f172a', text: '#ffffff', shadow: '0 4px 14px #0f172a30' },
    btnInactive: { bg: '#ffffff', text: '#64748b', border: '#e2e8f0' },
    btnNav: { bg: '#0f172a', text: '#ffffff' },
    btnNavDisabled: { bg: '#f1f5f9', text: '#cbd5e1' },
    svgBg: '#f8fafc',
    layerBgs:    ['#e0f2fe80', '#fef3c780', '#dcfce780', '#f3e8ff80', '#e0e7ff80'],
    layerLabels: ['#0369a1', '#b45309', '#15803d', '#7e22ce', '#4338ca'],
    arrow:      { sync: '#94a3b8', async: '#8b5cf6', active: '#2563eb', activeGlow: '#2563eb' },
    labelPill:  { bg: '#ffffff', text: '#0f172a', border: '#e2e8f0' },
    comp: {
      clients:  { color: '#0284c7', bg: '#e0f2fe', text: '#0c4a6e' },
      gateway:  { color: '#d97706', bg: '#fef3c7', text: '#78350f' },
      service:  { color: '#16a34a', bg: '#dcfce7', text: '#14532d' },
      redis:    { color: '#ea580c', bg: '#ffedd5', text: '#7c2d12' },
      postgres: { color: '#9333ea', bg: '#f3e8ff', text: '#581c87' },
      external: { color: '#4f46e5', bg: '#e0e7ff', text: '#3730a3' },
    },
    stepCard: { bg: '#f8fafc', border: '#e2e8f0', numBg: '#2563eb', numText: '#fff' },
    descCard: { bg: '#ffffff', border: '#2563eb', text: '#334155', labelBg: '#2563eb', labelText: '#fff' },
  },
};

// ---------- 5-LAYER COMPONENT POSITIONS ----------
const COMPS = {
  clients:          { x: 410, y: 50,  w: 240, h: 50, label: 'POS Terminals + Mobile', sub: 'React Native, SQLite',   type: 'clients',  rounded: false },
  gateway:          { x: 410, y: 150, w: 240, h: 50, label: 'API Gateway',             sub: 'REST + WebSocket',       type: 'gateway',  rounded: false },
  inventoryService: { x: 180, y: 250, w: 200, h: 50, label: 'Inventory Service',       sub: 'Stock Management',       type: 'service',  rounded: false },
  orderService:     { x: 680, y: 250, w: 200, h: 50, label: 'Order Service',           sub: 'Fulfillment + Refunds',  type: 'service',  rounded: false },
  redis:            { x: 120, y: 350, w: 170, h: 50, label: 'Redis',                   sub: 'Counts + Pub/Sub',       type: 'redis',    rounded: true },
  postgres:         { x: 450, y: 350, w: 180, h: 50, label: 'PostgreSQL',              sub: 'Events + Outbox',        type: 'postgres', rounded: false },
  reconcileWorker:  { x: 100, y: 460, w: 195, h: 50, label: 'Reconciliation Worker',   sub: 'Background Sync',        type: 'service',  rounded: false },
  prepQueue:        { x: 770, y: 460, w: 160, h: 50, label: 'Prep Queue',              sub: 'Fire & Forget',          type: 'redis',    rounded: true },
  stripe:           { x: 430, y: 460, w: 180, h: 50, label: 'Stripe',                  sub: 'Payments + Refunds',     type: 'external', rounded: false },
};

// Which components are visible per phase (cumulative)
const PHASE_COMPONENTS = {
  base:      ['clients', 'gateway', 'inventoryService', 'orderService', 'redis', 'postgres'],
  online:    ['clients', 'gateway', 'inventoryService', 'orderService', 'redis', 'postgres', 'prepQueue'],
  offline:   ['clients', 'gateway', 'inventoryService', 'orderService', 'redis', 'postgres', 'prepQueue', 'stripe'],
  reconcile: ['clients', 'gateway', 'inventoryService', 'orderService', 'redis', 'postgres', 'prepQueue', 'stripe', 'reconcileWorker'],
};

// ---------- ARROW GEOMETRY ----------
function getArrowPath(sourceKey, targetKey) {
  const s = COMPS[sourceKey];
  const t = COMPS[targetKey];
  if (!s || !t) return null;

  const sCX = s.x + s.w / 2;
  const sCY = s.y + s.h / 2;
  const tCX = t.x + t.w / 2;
  const tCY = t.y + t.h / 2;
  const gap = 14;

  const goingDown = tCY > sCY;
  let startX, startY, endX, endY;

  if (goingDown) {
    startX = sCX; startY = s.y + s.h;
    endX = tCX;   endY = t.y - gap;
  } else {
    startX = sCX; startY = s.y;
    endX = tCX;   endY = t.y + t.h + gap;
  }

  // Straight vertical
  if (Math.abs(startX - endX) < 5) {
    return { d: `M${startX},${startY} L${endX},${endY}`, midX: startX, midY: (startY + endY) / 2 };
  }

  // L-shape through the gap between layers
  const midY = goingDown
    ? Math.round((startY + t.y) / 2)
    : Math.round((startY + (t.y + t.h)) / 2);

  return {
    d: `M${startX},${startY} L${startX},${midY} L${endX},${midY} L${endX},${endY}`,
    midX: (startX + endX) / 2,
    midY,
  };
}

// ---------- SVG COMPONENTS ----------
const Layers = ({ theme }) => {
  const layers = [
    { y: 30,  h: 85,  label: 'PRESENTATION' },
    { y: 130, h: 85,  label: 'APPLICATION' },
    { y: 230, h: 85,  label: 'SERVICES' },
    { y: 330, h: 85,  label: 'DATA' },
    { y: 430, h: 100, label: 'WORKERS / EXTERNAL' },
  ];
  return (
    <g>
      {layers.map((l, i) => (
        <g key={i}>
          <rect x={50} y={l.y} width={970} height={l.h} fill={theme.layerBgs[i]} rx={10} />
          <text x={70} y={l.y + 14} fontSize="10" fontWeight="700" fill={theme.layerLabels[i]} letterSpacing="1">{l.label}</text>
        </g>
      ))}
    </g>
  );
};

const CompBox = ({ comp, theme, dimmed, highlighted }) => {
  const c = theme.comp[comp.type];
  const opacity = dimmed ? 0.3 : 1;

  return (
    <g opacity={opacity}>
      {highlighted && (
        <rect x={comp.x - 4} y={comp.y - 4} width={comp.w + 8} height={comp.h + 8}
          rx={comp.rounded ? 18 : 10} fill="none" stroke={theme.accent} strokeWidth={2.5} opacity={0.7}>
          <animate attributeName="opacity" values="0.7;0.3;0.7" dur="1.5s" repeatCount="indefinite" />
        </rect>
      )}
      <rect x={comp.x} y={comp.y} width={comp.w} height={comp.h}
        rx={comp.rounded ? 12 : 6} fill={c.bg} stroke={c.color}
        strokeWidth={highlighted ? 2.5 : 1.5} />
      <text x={comp.x + comp.w / 2} y={comp.y + 22} textAnchor="middle" fontSize="13" fontWeight="700" fill={c.text}>{comp.label}</text>
      <text x={comp.x + comp.w / 2} y={comp.y + 38} textAnchor="middle" fontSize="10" fontWeight="500" fill={c.color}>{comp.sub}</text>
    </g>
  );
};

// ---------- MAIN COMPONENT ----------
export default function ConcessionsWalkthrough() {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [isDark, setIsDark] = useState(true);

  const theme = isDark ? THEMES.dark : THEMES.light;
  const phase = PHASES[phaseIdx];
  const steps = STEPS[phase.id];
  const step = steps[stepIdx];
  const visibleComps = PHASE_COMPONENTS[phase.id];

  // Active components for current step
  const activeComps = new Set();
  if (step.self) {
    activeComps.add(step.source);
  } else {
    if (step.source) activeComps.add(step.source);
    if (step.target) activeComps.add(step.target);
  }

  // All previous arrows stay visible (dimmed)
  const prevArrows = steps.slice(0, stepIdx).filter(s => s.source && s.target);

  const selectPhase = (idx) => { setPhaseIdx(idx); setStepIdx(0); };
  const prevStep = () => setStepIdx(Math.max(0, stepIdx - 1));
  const nextStep = () => {
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else if (phaseIdx < PHASES.length - 1) {
      setPhaseIdx(phaseIdx + 1);
      setStepIdx(0);
    }
  };

  const isFirst = phaseIdx === 0 && stepIdx === 0;
  const isLast = phaseIdx === PHASES.length - 1 && stepIdx === steps.length - 1;

  return (
    <div style={{ padding: 24, background: theme.bg, minHeight: '100vh', transition: 'background 0.3s' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: theme.text, margin: 0 }}>Concessions Inventory System</h1>
            <p style={{ color: theme.textMuted, fontSize: 16, margin: '4px 0 0' }}>Step-through walkthrough — click Next to trace each hop</p>
          </div>
          <button onClick={() => setIsDark(!isDark)}
            style={{ padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isDark ? '#334155' : '#e2e8f0', color: isDark ? '#fbbf24' : '#475569', fontSize: 18 }}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Phase selector */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {PHASES.map((p, i) => {
            const active = i === phaseIdx;
            const s = active ? theme.btnActive : theme.btnInactive;
            return (
              <button key={p.id} onClick={() => selectPhase(i)}
                style={{ padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: active ? 'none' : `1px solid ${s.border}`,
                  background: s.bg, color: s.text, boxShadow: active ? s.shadow : 'none', transition: 'all 0.2s' }}>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Step indicator + nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={prevStep} disabled={isFirst}
            style={{ padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, border: 'none', cursor: isFirst ? 'not-allowed' : 'pointer',
              background: isFirst ? theme.btnNavDisabled.bg : theme.btnNav.bg, color: isFirst ? theme.btnNavDisabled.text : theme.btnNav.text }}>
            ← Prev
          </button>
          <span style={{ color: theme.textMuted, fontWeight: 600, fontSize: 16 }}>
            {phase.title} — Step {stepIdx + 1} / {steps.length}
          </span>
          <button onClick={nextStep} disabled={isLast}
            style={{ padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, border: 'none', cursor: isLast ? 'not-allowed' : 'pointer',
              background: isLast ? theme.btnNavDisabled.bg : theme.accent, color: isLast ? theme.btnNavDisabled.text : '#fff' }}>
            Next →
          </button>
        </div>

        {/* Description card */}
        <div style={{ background: theme.descCard.bg, border: `2px solid ${theme.descCard.border}`, borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ background: theme.descCard.labelBg, color: theme.descCard.labelText, borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
            {step.label}{step.async ? ' ⚡' : ''}
          </div>
          <p style={{ margin: 0, color: theme.descCard.text, fontSize: 15, lineHeight: 1.5 }}>{step.desc}</p>
        </div>

        {/* Diagram */}
        <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 20, marginBottom: 16, overflowX: 'auto' }}>
          <svg width="100%" height="560" viewBox="0 0 1070 560" style={{ minWidth: 800 }}>
            <defs>
              <marker id="mSync" markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
                <polygon points="0 0,12 5,0 10" fill={theme.arrow.sync} />
              </marker>
              <marker id="mAsync" markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
                <polygon points="0 0,12 5,0 10" fill={theme.arrow.async} />
              </marker>
              <marker id="mActive" markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
                <polygon points="0 0,12 5,0 10" fill={theme.arrow.active} />
              </marker>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            <rect x="0" y="0" width="1070" height="560" fill={theme.svgBg} rx="12" />
            <Layers theme={theme} />

            {/* Previous arrows (dimmed trail) */}
            {prevArrows.map((s, i) => {
              const path = getArrowPath(s.source, s.target);
              if (!path) return null;
              const isA = s.async;
              return (
                <path key={`prev-${i}`} d={path.d} fill="none"
                  stroke={isA ? theme.arrow.async : theme.arrow.sync}
                  strokeWidth={2} strokeDasharray={isA ? '8,5' : 'none'}
                  markerEnd={`url(#${isA ? 'mAsync' : 'mSync'})`}
                  opacity={0.25} strokeLinejoin="round" />
              );
            })}

            {/* Active arrow */}
            {step.source && step.target && (() => {
              const path = getArrowPath(step.source, step.target);
              if (!path) return null;
              return (
                <g filter="url(#glow)">
                  <path d={path.d} fill="none"
                    stroke={theme.arrow.active}
                    strokeWidth={3.5}
                    strokeDasharray={step.async ? '10,6' : 'none'}
                    markerEnd="url(#mActive)"
                    strokeLinejoin="round" />
                </g>
              );
            })()}

            {/* Components */}
            {Object.entries(COMPS).map(([key, comp]) => {
              if (!visibleComps.includes(key)) return null;
              const highlighted = activeComps.has(key);
              const dimmed = !highlighted && activeComps.size > 0;
              return <CompBox key={key} comp={comp} theme={theme} highlighted={highlighted} dimmed={dimmed} />;
            })}
          </svg>
        </div>

        {/* Step timeline */}
        <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {steps.map((s, i) => {
              const isCurrent = i === stepIdx;
              const isPast = i < stepIdx;
              return (
                <button key={i} onClick={() => setStepIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                    border: isCurrent ? `2px solid ${theme.accent}` : `1px solid ${theme.cardBorder}`,
                    background: isCurrent ? theme.accentGlow : 'transparent',
                    opacity: isPast ? 0.5 : 1,
                    transition: 'all 0.2s',
                  }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                    background: isCurrent ? theme.stepCard.numBg : isPast ? theme.textMuted : 'transparent',
                    color: isCurrent || isPast ? '#fff' : theme.textMuted,
                    border: !isCurrent && !isPast ? `1px solid ${theme.textMuted}` : 'none',
                  }}>
                    {isPast ? '✓' : i + 1}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? theme.text : theme.textMuted, whiteSpace: 'nowrap' }}>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.active} strokeWidth="3" /></svg>
            <span style={{ color: theme.textSub }}>Active hop</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.sync} strokeWidth="2" opacity="0.4" /></svg>
            <span style={{ color: theme.textSub }}>Previous (sync)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.async} strokeWidth="2" strokeDasharray="6,4" opacity="0.4" /></svg>
            <span style={{ color: theme.textSub }}>Previous (async)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: theme.textMuted }}>⚡ = async / event-driven</span>
          </div>
        </div>

        <div style={{ textAlign: 'center', color: theme.textMuted, fontSize: 13, marginTop: 16 }}>
          Kenneth Glenn • PlayOn Sports • Staff Software Engineer
        </div>
      </div>
    </div>
  );
}
