import { useState, useEffect, useId, useCallback, useMemo, useRef, type CSSProperties, type JSX } from 'react';

// ============================================================================
// CONCESSIONS INVENTORY SYSTEM — Step-Through Walkthrough (TypeScript)
// Click or use ← → arrow keys to trace each hop in the request flow.
// Active arrow + components highlight with a description panel per step.
// ============================================================================

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type PhaseId = 'base' | 'online' | 'offline' | 'reconcile';

type ComponentKey =
  | 'clients' | 'gateway' | 'inventoryService' | 'orderService'
  | 'redis' | 'postgres' | 'reconcileWorker' | 'prepQueue' | 'stripe';

type ComponentType = 'clients' | 'gateway' | 'service' | 'redis' | 'postgres' | 'external';

interface Phase {
  id: PhaseId;
  label: string;
  title: string;
}

interface Step {
  source: ComponentKey;
  target: ComponentKey | null;
  label: string;
  desc: string;
  isAsync?: boolean;
  self?: boolean;
}

interface ColorSet {
  color: string;
  bg: string;
  text: string;
}

interface ButtonStyle {
  bg: string;
  text: string;
  shadow?: string;
  border?: string;
}

interface DescCardTheme {
  bg: string;
  border: string;
  text: string;
  labelBg: string;
  labelText: string;
}

interface ArrowColors {
  sync: string;
  async: string;
  active: string;
}

interface Theme {
  bg: string;
  cardBg: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  textSub: string;
  accent: string;
  accentGlow: string;
  dimmedOpacity: number;
  btnActive: ButtonStyle;
  btnInactive: ButtonStyle;
  btnNav: ButtonStyle;
  btnNavDisabled: ButtonStyle;
  svgBg: string;
  // NOTE: layerBgs[i] and layerLabels[i] are index-aligned with LAYERS.
  // If LAYERS is reordered, these must be reordered to match.
  layerBgs: string[];
  layerLabels: string[];
  arrow: ArrowColors;
  comp: Record<ComponentType, ColorSet>;
  descCard: DescCardTheme;
  numBg: string;
  phaseFlash: string;
}

interface ArchComponent {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub: string;
  type: ComponentType;
  rounded: boolean;
}

interface Layer {
  y: number;
  h: number;
  label: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ARROWHEAD_GAP = 14;
const STRAIGHT_LINE_THRESHOLD = 15;
const SELF_LOOP_OFFSET = 10;

const PHASES: Phase[] = [
  { id: 'base',      label: 'Base',           title: 'Core Architecture' },
  { id: 'online',    label: 'Online Flow',    title: 'Real-Time Sales & Broadcast' },
  { id: 'offline',   label: 'Offline Flow',   title: 'Offline Sales & Local Storage' },
  { id: 'reconcile', label: 'Reconciliation', title: 'Sync & Conflict Resolution' },
];

const STEPS: Record<PhaseId, Step[]> = {
  base: [
    { source: 'clients',          target: 'gateway',          label: 'Sale Request',  desc: 'POS terminal sends a sale request (item, quantity, terminal ID) to the API Gateway over REST.' },
    { source: 'gateway',          target: 'inventoryService', label: 'Reserve Stock', desc: 'Gateway routes to Inventory Service to reserve stock before creating the order.' },
    { source: 'inventoryService', target: 'redis',            label: 'DECRBY',        desc: 'Inventory Service atomically decrements the count in Redis. If the value goes below zero, the sale is rejected.' },
    { source: 'inventoryService', target: 'postgres',         label: 'Stock Event',   desc: 'Inventory Service writes a stock_decremented event to PostgreSQL for the durable audit trail.' },
    { source: 'gateway',          target: 'orderService',     label: 'Create Order',  desc: 'Gateway calls Order Service to create the order record now that stock is reserved.' },
    { source: 'orderService',     target: 'postgres',         label: 'Order Event',   desc: 'Order Service writes an order_created event to PostgreSQL. This is async (outbox pattern) for delivery guarantee.', isAsync: true },
  ],
  online: [
    { source: 'inventoryService', target: 'redis',      label: 'Count Updated',  desc: 'After the decrement, the new count is available in Redis.' },
    { source: 'redis',            target: 'gateway',    label: 'Pub/Sub',        desc: 'Redis Pub/Sub broadcasts the updated count to the API Gateway.', isAsync: true },
    { source: 'gateway',          target: 'clients',    label: 'WebSocket Push', desc: 'Gateway pushes the new count to all connected terminals via WebSocket. Every POS screen updates in real time.' },
    { source: 'orderService',     target: 'prepQueue',  label: 'Send Order',     desc: 'Order Service fires the order to the Prep Queue (fire-and-forget). Kitchen staff see it on their display.', isAsync: true },
  ],
  offline: [
    { source: 'clients', target: null,     label: 'Heartbeat Lost',   desc: 'Terminal detects lost connectivity — no WebSocket heartbeat for 5 seconds. Switches to offline mode.', self: true },
    { source: 'clients', target: null,     label: 'Local Allocation', desc: 'Terminal sells against its cached proportional allocation (1/N of inventory). LOW_STOCK items are blocked.', self: true },
    { source: 'clients', target: 'stripe', label: 'Capture Payment',  desc: 'Stripe Terminal captures the payment offline — encrypted on device, will process when connectivity returns.' },
    { source: 'clients', target: null,     label: 'Store in SQLite',  desc: 'Sale stored locally in SQLite with a timestamp and terminal ID. This is the offline ledger for reconciliation.', self: true },
  ],
  reconcile: [
    { source: 'clients',         target: 'gateway',          label: 'Batch Sync',        desc: 'Terminal reconnects and sends an array of offline sales to the Gateway as a batch.' },
    { source: 'gateway',         target: 'reconcileWorker',  label: 'Enqueue Job',       desc: 'Gateway hands off to the Reconciliation Worker (background job) to process sales chronologically.' },
    { source: 'reconcileWorker', target: 'inventoryService', label: 'Attempt Decrement', desc: 'Worker calls Inventory Service to DECRBY in Redis for each offline sale. If count goes negative → conflict.' },
    { source: 'reconcileWorker', target: 'orderService',     label: 'Trigger Refund',    desc: 'For conflicted sales (oversold), Worker calls Order Service to initiate a refund.' },
    { source: 'orderService',    target: 'stripe',           label: 'Issue Refund',      desc: 'Order Service calls Stripe to refund the customer for items that were no longer available.' },
    { source: 'stripe',          target: 'clients',          label: 'Refund Confirmation', desc: 'Stripe pushes a refund confirmation back to the terminal asynchronously.', isAsync: true },
  ],
};

// ============================================================================
// THEMES
// ============================================================================

const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    bg: '#0f172a',
    cardBg: '#1e293b',
    cardBorder: '#334155',
    text: '#f1f5f9',
    textMuted: '#94a3b8',
    textSub: '#cbd5e1',
    accent: '#3b82f6',
    accentGlow: '#3b82f620',
    dimmedOpacity: 0.3,
    btnActive:      { bg: '#3b82f6', text: '#ffffff', shadow: '0 4px 14px #3b82f640' },
    btnInactive:    { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
    btnNav:         { bg: '#334155', text: '#f1f5f9' },
    btnNavDisabled: { bg: '#1e293b', text: '#475569' },
    svgBg: '#1e293b',
    layerBgs:    ['#0c4a6e25', '#78350f25', '#14532d25', '#581c8725', '#3730a325'],
    layerLabels: ['#38bdf8', '#fbbf24', '#4ade80', '#c084fc', '#818cf8'],
    arrow: { sync: '#475569', async: '#7c3aed', active: '#3b82f6' },
    comp: {
      clients:  { color: '#38bdf8', bg: '#0c4a6e', text: '#fff' },
      gateway:  { color: '#fbbf24', bg: '#78350f', text: '#fff' },
      service:  { color: '#4ade80', bg: '#14532d', text: '#fff' },
      redis:    { color: '#fb923c', bg: '#7c2d12', text: '#fff' },
      postgres: { color: '#c084fc', bg: '#581c87', text: '#fff' },
      external: { color: '#818cf8', bg: '#3730a3', text: '#fff' },
    },
    descCard: { bg: '#1e293b', border: '#3b82f6', text: '#e2e8f0', labelBg: '#3b82f6', labelText: '#fff' },
    numBg: '#3b82f6',
    phaseFlash: '#3b82f630',
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
    dimmedOpacity: 0.38,
    btnActive:      { bg: '#0f172a', text: '#ffffff', shadow: '0 4px 14px #0f172a30' },
    btnInactive:    { bg: '#ffffff', text: '#64748b', border: '#e2e8f0' },
    btnNav:         { bg: '#0f172a', text: '#ffffff' },
    btnNavDisabled: { bg: '#f1f5f9', text: '#cbd5e1' },
    svgBg: '#f8fafc',
    layerBgs:    ['#e0f2fe80', '#fef3c780', '#dcfce780', '#f3e8ff80', '#e0e7ff80'],
    layerLabels: ['#0369a1', '#b45309', '#15803d', '#7e22ce', '#4338ca'],
    arrow: { sync: '#94a3b8', async: '#8b5cf6', active: '#2563eb' },
    comp: {
      clients:  { color: '#0284c7', bg: '#e0f2fe', text: '#0c4a6e' },
      gateway:  { color: '#d97706', bg: '#fef3c7', text: '#78350f' },
      service:  { color: '#16a34a', bg: '#dcfce7', text: '#14532d' },
      redis:    { color: '#ea580c', bg: '#ffedd5', text: '#7c2d12' },
      postgres: { color: '#9333ea', bg: '#f3e8ff', text: '#581c87' },
      external: { color: '#4f46e5', bg: '#e0e7ff', text: '#3730a3' },
    },
    descCard: { bg: '#ffffff', border: '#2563eb', text: '#334155', labelBg: '#2563eb', labelText: '#fff' },
    numBg: '#2563eb',
    phaseFlash: '#2563eb20',
  },
};

// ============================================================================
// 5-LAYER COMPONENT LAYOUT
// ============================================================================

const ARCHITECTURE_COMPONENTS: Record<ComponentKey, ArchComponent> = {
  clients:          { x: 410, y: 50,  w: 240, h: 50, label: 'POS Terminals + Mobile', sub: 'React Native, SQLite',  type: 'clients',  rounded: false },
  gateway:          { x: 410, y: 150, w: 240, h: 50, label: 'API Gateway',            sub: 'REST + WebSocket',      type: 'gateway',  rounded: false },
  inventoryService: { x: 180, y: 250, w: 200, h: 50, label: 'Inventory Service',      sub: 'Stock Management',      type: 'service',  rounded: false },
  orderService:     { x: 680, y: 250, w: 200, h: 50, label: 'Order Service',          sub: 'Fulfillment + Refunds', type: 'service',  rounded: false },
  redis:            { x: 120, y: 350, w: 170, h: 50, label: 'Redis',                  sub: 'Counts + Pub/Sub',      type: 'redis',    rounded: true },
  postgres:         { x: 450, y: 350, w: 180, h: 50, label: 'PostgreSQL',             sub: 'Events + Outbox',       type: 'postgres', rounded: false },
  reconcileWorker:  { x: 100, y: 460, w: 195, h: 50, label: 'Reconciliation Worker',  sub: 'Background Sync',       type: 'service',  rounded: false },
  prepQueue:        { x: 770, y: 460, w: 160, h: 50, label: 'Prep Queue',             sub: 'Fire & Forget',         type: 'redis',    rounded: true },
  stripe:           { x: 430, y: 460, w: 180, h: 50, label: 'Stripe',                 sub: 'Payments + Refunds',    type: 'external', rounded: false },
};

// #1: Single assertion on static constant — avoids per-render `as` cast on Object.entries
const COMPONENT_KEYS = Object.keys(ARCHITECTURE_COMPONENTS) as ComponentKey[];

// #5: Derived from PHASES — single source of truth for phase ordering
const PHASE_ORDER = PHASES.map(p => p.id);

const PHASE_NEW_COMPONENTS: Record<PhaseId, ComponentKey[]> = {
  base:      ['clients', 'gateway', 'inventoryService', 'orderService', 'redis', 'postgres'],
  online:    ['prepQueue'],
  offline:   ['stripe'],
  reconcile: ['reconcileWorker'],
};
const PHASE_COMPONENTS: Record<PhaseId, ComponentKey[]> = PHASE_ORDER.reduce((acc, phase, i) => {
  acc[phase] = [...(i > 0 ? acc[PHASE_ORDER[i - 1]] : []), ...PHASE_NEW_COMPONENTS[phase]];
  return acc;
}, {} as Record<PhaseId, ComponentKey[]>);

// Layer definitions
const LAYERS: Layer[] = [
  { y: 30,  h: 85,  label: 'PRESENTATION' },
  { y: 130, h: 85,  label: 'APPLICATION' },
  { y: 230, h: 85,  label: 'SERVICES' },
  { y: 330, h: 85,  label: 'DATA' },
  { y: 430, h: 100, label: 'WORKERS / EXTERNAL' },
];

// ============================================================================
// ARROW GEOMETRY
// ============================================================================

function getArrowPath(sourceKey: ComponentKey, targetKey: ComponentKey): string | null {
  const s = ARCHITECTURE_COMPONENTS[sourceKey];
  const t = ARCHITECTURE_COMPONENTS[targetKey];
  if (!s || !t) return null;

  const goingDown = (t.y + t.h / 2) > (s.y + s.h / 2);
  const startX = s.x + s.w / 2;
  const startY = goingDown ? s.y + s.h : s.y;
  const endX = t.x + t.w / 2;
  const endY = goingDown ? t.y - ARROWHEAD_GAP : t.y + t.h + ARROWHEAD_GAP;

  if (Math.abs(startX - endX) < STRAIGHT_LINE_THRESHOLD) {
    return `M${startX},${startY} L${endX},${endY}`;
  }

  const midY = goingDown
    ? Math.round((startY + t.y) / 2)
    : Math.round((startY + (t.y + t.h)) / 2);

  return `M${startX},${startY} L${startX},${midY} L${endX},${midY} L${endX},${endY}`;
}

function getSelfLoopPath(compKey: ComponentKey): string | null {
  const c = ARCHITECTURE_COMPONENTS[compKey];
  if (!c) return null;
  const x = c.x + c.w - SELF_LOOP_OFFSET;
  const y = c.y;
  return `M${x},${y} C${x + 40},${y - 35} ${x + 55},${y + c.h + 35} ${x},${y + c.h}`;
}

// ============================================================================
// SVG SUB-COMPONENTS (#4: plain functions instead of React.FC)
// ============================================================================

interface SvgDefsProps { theme: Theme; uid: string }
function SvgDefs({ theme, uid }: SvgDefsProps): JSX.Element {
  return (
    <defs>
      <marker id={`${uid}-mSync`} markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
        <polygon points="0 0,12 5,0 10" fill={theme.arrow.sync} />
      </marker>
      <marker id={`${uid}-mAsync`} markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
        <polygon points="0 0,12 5,0 10" fill={theme.arrow.async} />
      </marker>
      <marker id={`${uid}-mActive`} markerWidth="14" markerHeight="12" refX="13" refY="6" orient="auto">
        <polygon points="0 0,14 6,0 12" fill={theme.arrow.active} />
      </marker>
    </defs>
  );
}

interface LayerBackgroundsProps { theme: Theme }
function LayerBackgrounds({ theme }: LayerBackgroundsProps): JSX.Element {
  return (
    <g>
      {LAYERS.map((l, i) => (
        <g key={i}>
          <rect x={50} y={l.y} width={970} height={l.h} fill={theme.layerBgs[i]} rx={10} />
          <text x={70} y={l.y + 14} fontSize="10" fontWeight="700" fill={theme.layerLabels[i]} letterSpacing="1">{l.label}</text>
        </g>
      ))}
    </g>
  );
}

interface ComponentBoxProps {
  comp: ArchComponent;
  theme: Theme;
  dimmed: boolean;
  highlighted: boolean;
  isSelfStep: boolean;
}
function ComponentBox({ comp, theme, dimmed, highlighted, isSelfStep }: ComponentBoxProps): JSX.Element {
  const c = theme.comp[comp.type];
  const opacity = dimmed ? theme.dimmedOpacity : 1;

  return (
    <g opacity={opacity}>
      {highlighted && (
        <rect
          x={comp.x - 4} y={comp.y - 4}
          width={comp.w + 8} height={comp.h + 8}
          rx={comp.rounded ? 18 : 10}
          fill="none" stroke={theme.accent} strokeWidth={2.5} opacity={0.7}
        >
          <animate attributeName="opacity" values="0.7;0.3;0.7" dur="1.5s" repeatCount="indefinite" />
        </rect>
      )}
      <rect
        x={comp.x} y={comp.y} width={comp.w} height={comp.h}
        rx={comp.rounded ? 12 : 6}
        fill={c.bg} stroke={c.color}
        strokeWidth={highlighted ? 2.5 : 1.5}
      />
      <text x={comp.x + comp.w / 2} y={comp.y + 22} textAnchor="middle" fontSize="13" fontWeight="700" fill={c.text}>{comp.label}</text>
      <text x={comp.x + comp.w / 2} y={comp.y + 38} textAnchor="middle" fontSize="10" fontWeight="500" fill={c.color}>{comp.sub}</text>
      {isSelfStep && (
        <text x={comp.x + comp.w + 16} y={comp.y + comp.h / 2 + 5} fontSize="16" fill={theme.accent}>⟳</text>
      )}
    </g>
  );
}

interface ArrowProps { step: Step; theme: Theme; uid: string }

function ActiveArrow({ step, theme, uid }: ArrowProps): JSX.Element | null {
  if (!step.source || !step.target) return null;
  const d = getArrowPath(step.source, step.target);
  if (!d) return null;
  const dash = step.isAsync ? '10,6' : 'none';
  return (
    <g>
      <path d={d} fill="none" stroke={theme.arrow.active} strokeWidth={10}
        strokeDasharray={dash} opacity={0.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke={theme.arrow.active} strokeWidth={3.5}
        strokeDasharray={dash} markerEnd={`url(#${uid}-mActive)`} strokeLinejoin="round" />
    </g>
  );
}

function SelfLoopArrow({ step, theme, uid }: ArrowProps): JSX.Element | null {
  if (!step.self) return null;
  const d = getSelfLoopPath(step.source);
  if (!d) return null;
  return (
    <g>
      <path d={d} fill="none" stroke={theme.arrow.active} strokeWidth={8}
        strokeDasharray="6,4" opacity={0.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke={theme.arrow.active} strokeWidth={2.5}
        strokeDasharray="6,4" markerEnd={`url(#${uid}-mActive)`} strokeLinejoin="round" />
    </g>
  );
}

function TrailArrow({ step, theme, uid }: ArrowProps): JSX.Element | null {
  if (!step.source || !step.target) return null;
  const d = getArrowPath(step.source, step.target);
  if (!d) return null;
  const isAsync = step.isAsync;
  return (
    <path d={d} fill="none"
      stroke={isAsync ? theme.arrow.async : theme.arrow.sync}
      strokeWidth={2} strokeDasharray={isAsync ? '8,5' : 'none'}
      markerEnd={`url(#${uid}-${isAsync ? 'mAsync' : 'mSync'})`}
      opacity={0.25} strokeLinejoin="round" />
  );
}

// ============================================================================
// STYLES (#6: satisfies for static objects, typed returns for functions)
// ============================================================================

const S = {
  root: (bg: string): CSSProperties => ({ padding: 24, background: bg, minHeight: '100vh', transition: 'background 0.3s' }),
  container: { maxWidth: 1100, margin: '0 auto' } satisfies CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 } satisfies CSSProperties,
  title: (color: string): CSSProperties => ({ fontSize: 28, fontWeight: 800, color, margin: 0 }),
  subtitle: (color: string): CSSProperties => ({ color, fontSize: 16, margin: '4px 0 0' }),
  themeBtn: (isDark: boolean): CSSProperties => ({
    padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 18,
    background: isDark ? '#334155' : '#e2e8f0', color: isDark ? '#fbbf24' : '#475569',
  }),
  phaseRow: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' } satisfies CSSProperties,
  phaseBtn: (s: ButtonStyle, active: boolean): CSSProperties => ({
    padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
    border: active ? 'none' : `1px solid ${s.border || 'transparent'}`,
    background: s.bg, color: s.text,
    boxShadow: active ? s.shadow : 'none', transition: 'all 0.2s',
  }),
  navRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } satisfies CSSProperties,
  navBtn: (enabled: boolean, bg: string, color: string): CSSProperties => ({
    padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, border: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed', background: bg, color,
  }),
  stepCounter: (color: string): CSSProperties => ({ color, fontWeight: 600, fontSize: 16 }),
  showAllBtn: (theme: Theme): CSSProperties => ({
    padding: '6px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
    border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.textMuted, marginLeft: 8,
  }),
  descCard: (t: DescCardTheme): CSSProperties => ({
    background: t.bg, border: `2px solid ${t.border}`, borderRadius: 12,
    padding: 16, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14,
  }),
  descLabel: (t: DescCardTheme): CSSProperties => ({
    background: t.labelBg, color: t.labelText, borderRadius: 8,
    padding: '6px 14px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
  }),
  descText: (color: string): CSSProperties => ({ margin: 0, color, fontSize: 15, lineHeight: 1.5 }),
  svgCard: (t: Theme): CSSProperties => ({
    background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
    padding: 20, marginBottom: 16, overflowX: 'auto', position: 'relative',
  }),
  phaseFlash: (color: string): CSSProperties => ({
    position: 'absolute', inset: 0, background: color, borderRadius: 14, pointerEvents: 'none',
  }),
  timelineCard: (t: Theme): CSSProperties => ({
    background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
    padding: 16, marginBottom: 16,
  }),
  timelineRow: { display: 'flex', flexWrap: 'wrap', gap: 8 } satisfies CSSProperties,
  timelineBtn: (isCurrent: boolean, theme: Theme): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
    border: isCurrent ? `2px solid ${theme.accent}` : `1px solid ${theme.cardBorder}`,
    background: isCurrent ? theme.accentGlow : 'transparent', transition: 'all 0.2s',
  }),
  timelineNum: (isCurrent: boolean, isPast: boolean, theme: Theme): CSSProperties => ({
    width: 24, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0,
    background: isCurrent ? theme.numBg : isPast ? theme.textMuted : 'transparent',
    color: isCurrent || isPast ? '#fff' : theme.textMuted,
    border: !isCurrent && !isPast ? `1px solid ${theme.textMuted}` : 'none',
  }),
  timelineLabel: (isCurrent: boolean, theme: Theme): CSSProperties => ({
    fontSize: 13, fontWeight: isCurrent ? 700 : 500,
    color: isCurrent ? theme.text : theme.textMuted, whiteSpace: 'nowrap',
  }),
  legendCard: (t: Theme): CSSProperties => ({
    background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
    padding: 14, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13,
    justifyContent: 'center',
  }),
  legendItem: { display: 'flex', alignItems: 'center', gap: 8 } satisfies CSSProperties,
  footer: (color: string): CSSProperties => ({ textAlign: 'center', color, fontSize: 13, marginTop: 16 }),
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ConcessionsWalkthrough(): JSX.Element {
  // #3: Let TS infer primitives from initial values
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [isDark, setIsDark] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [phaseFlash, setPhaseFlash] = useState(false);

  // #2: Timer ref for cleanup on unmount
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const uid = useId().replace(/:/g, '');

  const theme = isDark ? THEMES.dark : THEMES.light;
  const phase = PHASES[phaseIdx];
  const steps = STEPS[phase.id];
  const step = steps[stepIdx];
  const visibleComps = PHASE_COMPONENTS[phase.id];

  const activeComps = useMemo<Set<ComponentKey>>(() => {
    if (showAll) return new Set();
    const set = new Set<ComponentKey>();
    if (step.self) {
      set.add(step.source);
    } else {
      if (step.source) set.add(step.source);
      if (step.target) set.add(step.target);
    }
    return set;
  }, [step, showAll]);

  const prevArrows = useMemo<Step[]>(() => {
    if (showAll) return steps.filter(s => s.source && s.target);
    return steps.slice(0, stepIdx).filter(s => s.source && s.target);
  }, [steps, stepIdx, showAll]);

  // #2: Phase flash with proper cleanup
  const triggerPhaseFlash = useCallback((): void => {
    setPhaseFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setPhaseFlash(false), 400);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const selectPhase = useCallback((idx: number): void => {
    setPhaseIdx(idx);
    setStepIdx(0);
    setShowAll(false);
    triggerPhaseFlash();
  }, [triggerPhaseFlash]);

  const prevStep = useCallback((): void => {
    setShowAll(false);
    if (stepIdx > 0) {
      setStepIdx(stepIdx - 1);
    } else if (phaseIdx > 0) {
      const prevPhaseId = PHASES[phaseIdx - 1].id;
      setPhaseIdx(phaseIdx - 1);
      setStepIdx(STEPS[prevPhaseId].length - 1);
      triggerPhaseFlash();
    }
  }, [stepIdx, phaseIdx, triggerPhaseFlash]);

  const nextStep = useCallback((): void => {
    setShowAll(false);
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else if (phaseIdx < PHASES.length - 1) {
      setPhaseIdx(phaseIdx + 1);
      setStepIdx(0);
      triggerPhaseFlash();
    }
  }, [stepIdx, steps.length, phaseIdx, triggerPhaseFlash]);

  const toggleShowAll = useCallback((): void => {
    setShowAll(prev => !prev);
    setStepIdx(steps.length - 1);
  }, [steps.length]);

  const isFirst = phaseIdx === 0 && stepIdx === 0;
  const isLast = phaseIdx === PHASES.length - 1 && stepIdx === steps.length - 1;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextStep(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prevStep(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [nextStep, prevStep]);

  return (
    <div style={S.root(theme.bg)}>
      <div style={S.container}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <h1 style={S.title(theme.text)}>Concessions Inventory System</h1>
            <p style={S.subtitle(theme.textMuted)}>Step-through walkthrough — use ← → keys or click Next</p>
          </div>
          <button onClick={() => setIsDark(!isDark)} style={S.themeBtn(isDark)}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Phase selector */}
        <div style={S.phaseRow}>
          {PHASES.map((p, i) => {
            const active = i === phaseIdx;
            const btnStyle = active ? theme.btnActive : theme.btnInactive;
            return (
              <button key={p.id} onClick={() => selectPhase(i)} style={S.phaseBtn(btnStyle, active)}>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Step nav + show-all toggle */}
        <div style={S.navRow}>
          <button onClick={prevStep} disabled={isFirst && !showAll}
            style={S.navBtn(
              !isFirst || showAll,
              isFirst && !showAll ? theme.btnNavDisabled.bg : theme.btnNav.bg,
              isFirst && !showAll ? theme.btnNavDisabled.text : theme.btnNav.text
            )}>
            ← Prev
          </button>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={S.stepCounter(theme.textMuted)}>
              {phase.title} — {showAll ? 'All Steps' : `Step ${stepIdx + 1} / ${steps.length}`}
            </span>
            <button onClick={toggleShowAll} style={S.showAllBtn(theme)}>
              {showAll ? 'Step Mode' : 'Show All'}
            </button>
          </div>
          <button onClick={nextStep} disabled={isLast || showAll}
            style={S.navBtn(
              !isLast && !showAll,
              isLast || showAll ? theme.btnNavDisabled.bg : theme.accent,
              isLast || showAll ? theme.btnNavDisabled.text : '#fff'
            )}>
            Next →
          </button>
        </div>

        {/* Description card (hidden in show-all mode) */}
        {!showAll && (
          <div style={S.descCard(theme.descCard)}>
            <div style={S.descLabel(theme.descCard)}>
              {step.label}{step.isAsync ? ' ⚡' : ''}{step.self ? ' ⟳' : ''}
            </div>
            <p style={S.descText(theme.descCard.text)}>{step.desc}</p>
          </div>
        )}

        {/* Diagram */}
        <div style={S.svgCard(theme)}>
          {phaseFlash && (
            <div style={{ ...S.phaseFlash(theme.phaseFlash), animation: 'phaseFlashOut 0.4s ease-out forwards' }} />
          )}
          <style>{`@keyframes phaseFlashOut { from { opacity: 1; } to { opacity: 0; } }`}</style>

          <svg width="100%" height="560" viewBox="0 0 1070 560" style={{ minWidth: 800 }}>
            <SvgDefs theme={theme} uid={uid} />
            <rect x="0" y="0" width="1070" height="560" fill={theme.svgBg} rx="12" />
            <LayerBackgrounds theme={theme} />

            {prevArrows.map((s, i) => (
              <TrailArrow key={`trail-${i}`} step={s} theme={theme} uid={uid} />
            ))}

            {/* #1: Iterate COMPONENT_KEYS instead of casting Object.entries */}
            {COMPONENT_KEYS.map((key) => {
              if (!visibleComps.includes(key)) return null;
              const comp = ARCHITECTURE_COMPONENTS[key];
              const highlighted = activeComps.has(key);
              const dimmed = !showAll && !highlighted && activeComps.size > 0;
              const isSelfStep = !showAll && !!step.self && step.source === key;
              return (
                <ComponentBox key={key} comp={comp} theme={theme}
                  highlighted={highlighted} dimmed={dimmed} isSelfStep={isSelfStep} />
              );
            })}

            {!showAll && (
              <>
                <ActiveArrow step={step} theme={theme} uid={uid} />
                <SelfLoopArrow step={step} theme={theme} uid={uid} />
              </>
            )}
          </svg>
        </div>

        {/* Step timeline */}
        <div style={S.timelineCard(theme)}>
          <div style={S.timelineRow}>
            {steps.map((s, i) => {
              const isCurrent = !showAll && i === stepIdx;
              const isPast = !showAll && i < stepIdx;
              return (
                <button key={i} onClick={() => { setShowAll(false); setStepIdx(i); }}
                  style={{ ...S.timelineBtn(isCurrent, theme), opacity: isPast ? 0.5 : 1 }}>
                  <span style={S.timelineNum(isCurrent, isPast, theme)}>
                    {isPast ? '✓' : i + 1}
                  </span>
                  <span style={S.timelineLabel(isCurrent, theme)}>
                    {s.label}{s.isAsync ? ' ⚡' : ''}{s.self ? ' ⟳' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={S.legendCard(theme)}>
          <div style={S.legendItem}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.active} strokeWidth="3" /></svg>
            <span style={{ color: theme.textSub }}>Active hop</span>
          </div>
          <div style={S.legendItem}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.sync} strokeWidth="2" opacity="0.4" /></svg>
            <span style={{ color: theme.textSub }}>Previous (sync)</span>
          </div>
          <div style={S.legendItem}>
            <svg width="36" height="4"><line x1="0" y1="2" x2="36" y2="2" stroke={theme.arrow.async} strokeWidth="2" strokeDasharray="6,4" opacity="0.4" /></svg>
            <span style={{ color: theme.textSub }}>Previous (async)</span>
          </div>
          <div style={S.legendItem}>
            <span style={{ color: theme.textMuted }}>⚡ Async</span>
          </div>
          <div style={S.legendItem}>
            <span style={{ color: theme.textMuted }}>⟳ Self-Action</span>
          </div>
          <div style={S.legendItem}>
            <span style={{ color: theme.textMuted }}>← → Keyboard Nav</span>
          </div>
        </div>

        <div style={S.footer(theme.textMuted)}>
          Kenneth Glenn • PlayOn Sports • Staff Software Engineer
        </div>
      </div>
    </div>
  );
}
