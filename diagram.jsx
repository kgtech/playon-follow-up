import React, { useState } from 'react';

// ============================================================================
// CONCESSIONS INVENTORY SYSTEM - Interactive Architecture Diagram
// ============================================================================

const PHASES = [
  {
    id: 'base',
    label: 'Base',
    title: 'Base Architecture',
    description: 'Core components: API Gateway, Inventory Service, Redis for real-time counts, PostgreSQL for persistence',
    sayOutLoud: "Let me start with the foundation. We have POS terminals and a mobile app as clients. Everything routes through an API Gateway for auth and rate limiting. The Inventory Service is the core — it manages stock levels. I'm using Redis for real-time inventory counts because we need atomic decrements and sub-second reads. PostgreSQL stores the durable data: events, products, inventory items, and the immutable audit log."
  },
  {
    id: 'fr1',
    label: 'FR1+2',
    title: 'Real-Time Inventory & Broadcast',
    description: 'Adding WebSocket Gateway for real-time updates to all terminals when inventory changes',
    sayOutLoud: "Now for real-time broadcast. When Terminal A sells a hot dog, Terminals B through F need to see the updated count within 2 seconds. I'm adding a WebSocket Gateway that subscribes to Redis Pub/Sub. Every inventory change publishes to a channel, and the WebSocket Gateway fans out to all connected terminals. This is the same pattern as Maestro's event fan-out — Redis Pub/Sub is fast and the terminal count is small enough that we don't need Kafka here."
  },
  {
    id: 'fr2',
    label: 'FR3+4',
    title: 'Offline Mode & Proportional Allocation',
    description: 'Terminals cache inventory snapshot, calculate 1/N allocation, store sales locally in SQLite',
    sayOutLoud: "Here's where it gets interesting — offline support. Each terminal has a local SQLite database. While online, it periodically caches its offline allocation: last-known inventory divided by terminal count. When connectivity drops, it flips to offline mode and sells against that local allocation. LOW_STOCK items are blocked entirely — too risky to sell offline. Sales are queued locally with PENDING_SYNC status. Stripe Terminal SDK handles payment capture offline — it stores encrypted card data locally."
  },
  {
    id: 'fr3',
    label: 'FR5+6',
    title: 'Admin Restock & Audit Trail',
    description: 'Admin Portal for restocking, Event Store for immutable audit log of all inventory changes',
    sayOutLoud: "Admins need to restock mid-event — the truck arrives with 200 more waters. The Admin Portal calls the Inventory Service, which writes a RESTOCK event to the Event Store, increments Redis, and broadcasts to all terminals. Every change — sales, restocks, adjustments, reconciliations — is an immutable event. Current inventory is computable from the event stream. This is event sourcing — same pattern I used for the settlement ledger."
  },
  {
    id: 'deep',
    label: 'Deep Dives',
    title: 'Reconciliation & Refunds',
    description: 'Reconciliation Worker syncs offline sales, Refund Worker processes Stripe refunds via Outbox pattern',
    sayOutLoud: "The reconciliation flow is critical. When a terminal reconnects, it batch-syncs its offline sales. The Reconciliation Worker processes each sale chronologically — attempts to decrement central inventory. If inventory goes negative, it checks: did a restock happen that covers this? If yes, honor the sale. If the item is truly gone, mark it for refund. Refund requests go to an Outbox table — same transaction that marks the sale. A Refund Worker polls the outbox and calls Stripe's Refund API with idempotency keys. This is the Outbox Pattern — guarantees we never lose a refund request even if Stripe is temporarily down."
  }
];

const COMPONENTS = {
  // Clients (blue swim lane)
  posTerminal: { x: 50, y: 80, w: 120, h: 70, label: 'POS Terminal', sub: 'React Native + SQLite', color: '#0ea5e9', bg: '#f0f9ff', phase: 'base' },
  mobileApp: { x: 50, y: 170, w: 120, h: 70, label: 'Web/Mobile App', sub: 'Customer Orders', color: '#0ea5e9', bg: '#f0f9ff', phase: 'base' },
  adminPortal: { x: 50, y: 260, w: 120, h: 70, label: 'Admin Portal', sub: 'Manager Dashboard', color: '#0ea5e9', bg: '#f0f9ff', phase: 'fr3' },
  
  // Gateway (yellow swim lane)
  apiGateway: { x: 220, y: 130, w: 110, h: 70, label: 'API Gateway', sub: 'Auth + Rate Limit', color: '#eab308', bg: '#fefce8', phase: 'base' },
  wsGateway: { x: 220, y: 220, w: 110, h: 70, label: 'WebSocket GW', sub: 'Real-time Push', color: '#eab308', bg: '#fefce8', phase: 'fr1' },
  
  // Services (green swim lane)
  inventoryService: { x: 380, y: 80, w: 130, h: 70, label: 'Inventory Service', sub: 'Stock Management', color: '#22c55e', bg: '#f0fdf4', phase: 'base' },
  terminalRegistry: { x: 380, y: 170, w: 130, h: 70, label: 'Terminal Registry', sub: 'Heartbeat + Count', color: '#22c55e', bg: '#f0fdf4', phase: 'fr2' },
  orderService: { x: 380, y: 260, w: 130, h: 70, label: 'Order Service', sub: 'Fulfillment Queue', color: '#22c55e', bg: '#f0fdf4', phase: 'fr1' },
  
  // Cache/Store (orange for Redis)
  redis: { x: 560, y: 80, w: 110, h: 70, label: 'Redis Cluster', sub: 'Inventory Counts', color: '#f97316', bg: '#fff7ed', phase: 'base', rounded: true },
  redisPubSub: { x: 560, y: 170, w: 110, h: 70, label: 'Redis Pub/Sub', sub: 'Broadcast Channel', color: '#f97316', bg: '#fff7ed', phase: 'fr1', rounded: true },
  
  // Data (purple swim lane)
  postgres: { x: 560, y: 280, w: 110, h: 70, label: 'PostgreSQL', sub: 'Events, Products, Users', color: '#8b5cf6', bg: '#faf5ff', phase: 'base' },
  eventStore: { x: 720, y: 280, w: 110, h: 70, label: 'Event Store', sub: 'Immutable Audit Log', color: '#8b5cf6', bg: '#faf5ff', phase: 'fr3' },
  outbox: { x: 720, y: 370, w: 110, h: 70, label: 'Outbox Table', sub: 'Refund Intents', color: '#8b5cf6', bg: '#faf5ff', phase: 'deep', deepDive: true },
  
  // Workers (red for deep dive additions)
  reconciliationWorker: { x: 380, y: 370, w: 130, h: 70, label: 'Reconciliation', sub: 'Offline Sync Worker', color: '#ef4444', bg: '#fef2f2', phase: 'deep', deepDive: true },
  refundWorker: { x: 560, y: 370, w: 110, h: 70, label: 'Refund Worker', sub: 'Stripe Refunds', color: '#ef4444', bg: '#fef2f2', phase: 'deep', deepDive: true },
  
  // External (orange swim lane)
  stripeTerminal: { x: 720, y: 80, w: 110, h: 70, label: 'Stripe Terminal', sub: 'Offline Payments', color: '#f97316', bg: '#fff7ed', phase: 'fr2' },
  stripeAPI: { x: 720, y: 170, w: 110, h: 70, label: 'Stripe API', sub: 'Refund Processing', color: '#f97316', bg: '#fff7ed', phase: 'deep', deepDive: true },
  prepDisplay: { x: 220, y: 370, w: 110, h: 70, label: 'Prep Display', sub: 'Kitchen/Bagging', color: '#f97316', bg: '#fff7ed', phase: 'fr1' },
  snsQueue: { x: 220, y: 290, w: 110, h: 70, label: 'SNS/SQS', sub: 'Order Queue', color: '#f97316', bg: '#fff7ed', phase: 'fr1' }
};

const ARROWS = [
  // Base architecture
  { from: 'posTerminal', to: 'apiGateway', phase: 'base', step: 1 },
  { from: 'mobileApp', to: 'apiGateway', phase: 'base', step: 1 },
  { from: 'apiGateway', to: 'inventoryService', phase: 'base', step: 2 },
  { from: 'inventoryService', to: 'redis', phase: 'base', step: 3, label: 'DECRBY' },
  { from: 'inventoryService', to: 'postgres', phase: 'base', step: 4, async: true },
  
  // FR1+2: Real-time broadcast
  { from: 'inventoryService', to: 'redisPubSub', phase: 'fr1', step: 5, label: 'Publish' },
  { from: 'redisPubSub', to: 'wsGateway', phase: 'fr1', step: 6 },
  { from: 'wsGateway', to: 'posTerminal', phase: 'fr1', step: 7, label: 'Push Update' },
  { from: 'inventoryService', to: 'snsQueue', phase: 'fr1', step: null, async: true, label: 'ORDER_PLACED' },
  { from: 'snsQueue', to: 'prepDisplay', phase: 'fr1', step: null, async: true },
  
  // FR3+4: Offline mode
  { from: 'apiGateway', to: 'terminalRegistry', phase: 'fr2', step: null, label: 'Heartbeat' },
  { from: 'posTerminal', to: 'stripeTerminal', phase: 'fr2', step: null, label: 'Offline Payment' },
  
  // FR5+6: Admin + Audit
  { from: 'adminPortal', to: 'apiGateway', phase: 'fr3', step: null },
  { from: 'inventoryService', to: 'eventStore', phase: 'fr3', step: null, async: true, label: 'Append Event' },
  { from: 'postgres', to: 'eventStore', phase: 'fr3', step: null, label: 'Event Source' },
  
  // Deep dives: Reconciliation + Refunds
  { from: 'posTerminal', to: 'reconciliationWorker', phase: 'deep', step: null, deepDive: true, label: 'Batch Sync' },
  { from: 'reconciliationWorker', to: 'inventoryService', phase: 'deep', step: null, deepDive: true },
  { from: 'reconciliationWorker', to: 'outbox', phase: 'deep', step: null, deepDive: true, label: 'Refund Intent' },
  { from: 'outbox', to: 'refundWorker', phase: 'deep', step: null, deepDive: true, label: 'Poll' },
  { from: 'refundWorker', to: 'stripeAPI', phase: 'deep', step: null, deepDive: true, label: 'Refund' }
];

const SEQUENCE_STEPS = [
  // Online Sale Flow
  { from: 'posTerminal', to: 'apiGateway', label: '1. POST /decrement', phase: 'base' },
  { from: 'apiGateway', to: 'inventoryService', label: '2. Validate + Process', phase: 'base' },
  { from: 'inventoryService', to: 'redis', label: '3. DECRBY (atomic)', phase: 'base' },
  { from: 'redis', to: 'inventoryService', label: '4. New count or reject', phase: 'base', isReturn: true },
  { from: 'inventoryService', to: 'postgres', label: '5. Write InventoryEvent', phase: 'base', isAsync: true },
  { from: 'inventoryService', to: 'redisPubSub', label: '6. Publish update', phase: 'fr1' },
  { from: 'redisPubSub', to: 'wsGateway', label: '7. Fan out', phase: 'fr1' },
  { from: 'wsGateway', to: 'posTerminal', label: '8. Push to all terminals', phase: 'fr1', isReturn: true },
  
  // Order Fulfillment
  { from: 'inventoryService', to: 'snsQueue', label: '9. ORDER_PLACED event', phase: 'fr1', isAsync: true },
  { from: 'snsQueue', to: 'prepDisplay', label: '10. Display order', phase: 'fr1', isAsync: true },
  
  // Offline + Reconnect
  { from: 'posTerminal', to: 'posTerminal', label: '11. Offline: sell from local allocation', phase: 'fr2', isSelf: true },
  { from: 'posTerminal', to: 'stripeTerminal', label: '12. Capture payment locally', phase: 'fr2' },
  { from: 'posTerminal', to: 'reconciliationWorker', label: '13. Reconnect: batch sync', phase: 'deep', deepDive: true },
  { from: 'reconciliationWorker', to: 'inventoryService', label: '14. Attempt decrements', phase: 'deep', deepDive: true },
  { from: 'reconciliationWorker', to: 'outbox', label: '15. Write refund intent (if conflict)', phase: 'deep', deepDive: true },
  { from: 'outbox', to: 'refundWorker', label: '16. Poll outbox', phase: 'deep', deepDive: true },
  { from: 'refundWorker', to: 'stripeAPI', label: '17. Process refund', phase: 'deep', deepDive: true }
];

// Helper to determine if a component/arrow should be visible in current phase
const getPhaseIndex = (phaseId) => PHASES.findIndex(p => p.id === phaseId);

const isVisibleInPhase = (itemPhase, currentPhase) => {
  return getPhaseIndex(itemPhase) <= getPhaseIndex(currentPhase);
};

// Arrow marker definitions
const ArrowMarkers = () => (
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
    </marker>
    <marker id="arrowhead-async" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#8b5cf6" />
    </marker>
    <marker id="arrowhead-deep" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
    </marker>
  </defs>
);

// Component box
const ComponentBox = ({ comp, visible }) => {
  if (!visible) return null;
  
  const borderRadius = comp.rounded ? 16 : 8;
  const borderStyle = comp.deepDive ? '3px dashed #ef4444' : `2px solid ${comp.color}`;
  
  return (
    <g>
      <rect
        x={comp.x}
        y={comp.y}
        width={comp.w}
        height={comp.h}
        rx={borderRadius}
        fill={comp.bg}
        stroke={comp.color}
        strokeWidth={comp.deepDive ? 3 : 2}
        strokeDasharray={comp.deepDive ? "8,4" : "none"}
      />
      <text x={comp.x + comp.w/2} y={comp.y + 28} textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b">
        {comp.label}
      </text>
      <text x={comp.x + comp.w/2} y={comp.y + 46} textAnchor="middle" fontSize="10" fill="#64748b">
        {comp.sub}
      </text>
    </g>
  );
};

// Arrow with optional step number and label
const Arrow = ({ arrow, components, visible }) => {
  if (!visible) return null;
  
  const from = components[arrow.from];
  const to = components[arrow.to];
  if (!from || !to) return null;
  
  // Calculate start and end points (center of boxes)
  const fromX = from.x + from.w / 2;
  const fromY = from.y + from.h / 2;
  const toX = to.x + to.w / 2;
  const toY = to.y + to.h / 2;
  
  // Adjust to connect at edges
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const startX = fromX + Math.cos(angle) * (from.w / 2 + 5);
  const startY = fromY + Math.sin(angle) * (from.h / 2 + 5);
  const endX = toX - Math.cos(angle) * (to.w / 2 + 15);
  const endY = toY - Math.sin(angle) * (to.h / 2 + 15);
  
  const strokeColor = arrow.deepDive ? '#ef4444' : arrow.async ? '#8b5cf6' : '#475569';
  const markerId = arrow.deepDive ? 'arrowhead-deep' : arrow.async ? 'arrowhead-async' : 'arrowhead';
  const strokeDash = (arrow.async || arrow.deepDive) ? '6,4' : 'none';
  
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  
  return (
    <g>
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={strokeColor}
        strokeWidth={2}
        strokeDasharray={strokeDash}
        markerEnd={`url(#${markerId})`}
      />
      {arrow.step && (
        <g>
          <circle cx={midX} cy={midY} r={12} fill="#1e293b" />
          <text x={midX} y={midY + 4} textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
            {arrow.step}
          </text>
        </g>
      )}
      {arrow.label && (
        <text x={midX} y={midY - 16} textAnchor="middle" fontSize="9" fill="#64748b" fontStyle="italic">
          {arrow.label}
        </text>
      )}
    </g>
  );
};

// Sequence diagram view
const SequenceDiagram = ({ currentPhase }) => {
  const actors = ['posTerminal', 'apiGateway', 'inventoryService', 'redis', 'redisPubSub', 'wsGateway', 'snsQueue', 'prepDisplay', 'stripeTerminal', 'reconciliationWorker', 'outbox', 'refundWorker', 'stripeAPI'];
  const actorLabels = {
    posTerminal: 'POS',
    apiGateway: 'Gateway',
    inventoryService: 'Inventory',
    redis: 'Redis',
    redisPubSub: 'Pub/Sub',
    wsGateway: 'WebSocket',
    snsQueue: 'SNS/SQS',
    prepDisplay: 'Prep',
    stripeTerminal: 'Stripe Term',
    reconciliationWorker: 'Reconcile',
    outbox: 'Outbox',
    refundWorker: 'Refund',
    stripeAPI: 'Stripe API'
  };
  
  const actorX = {};
  const spacing = 75;
  actors.forEach((a, i) => { actorX[a] = 60 + i * spacing; });
  
  const visibleSteps = SEQUENCE_STEPS.filter(step => isVisibleInPhase(step.phase, currentPhase));
  
  return (
    <svg width="100%" height="520" viewBox="0 0 1050 520">
      {/* Actor headers */}
      {actors.map(actor => (
        <g key={actor}>
          <rect x={actorX[actor] - 30} y={10} width={60} height={35} rx={4} fill="#f1f5f9" stroke="#94a3b8" />
          <text x={actorX[actor]} y={32} textAnchor="middle" fontSize="9" fontWeight="600" fill="#334155">
            {actorLabels[actor]}
          </text>
          <line x1={actorX[actor]} y1={50} x2={actorX[actor]} y2={500} stroke="#cbd5e1" strokeDasharray="4,4" />
        </g>
      ))}
      
      {/* Sequence arrows */}
      {visibleSteps.map((step, i) => {
        const y = 70 + i * 25;
        const fromX = actorX[step.from];
        const toX = actorX[step.to];
        const isReturn = step.isReturn;
        const isSelf = step.isSelf;
        const isAsync = step.isAsync;
        const isDeep = step.deepDive;
        
        const strokeColor = isDeep ? '#ef4444' : isAsync ? '#8b5cf6' : '#475569';
        const strokeDash = (isAsync || isDeep) ? '4,3' : 'none';
        
        if (isSelf) {
          return (
            <g key={i}>
              <path
                d={`M ${fromX} ${y} C ${fromX + 40} ${y}, ${fromX + 40} ${y + 20}, ${fromX} ${y + 20}`}
                fill="none"
                stroke={strokeColor}
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
              />
              <text x={fromX + 45} y={y + 12} fontSize="8" fill="#64748b">{step.label}</text>
            </g>
          );
        }
        
        return (
          <g key={i}>
            <line
              x1={fromX}
              y1={y}
              x2={toX - (isReturn ? -8 : 8)}
              y2={y}
              stroke={strokeColor}
              strokeWidth={1.5}
              strokeDasharray={strokeDash}
              markerEnd="url(#arrowhead)"
            />
            <text x={(fromX + toX) / 2} y={y - 4} textAnchor="middle" fontSize="8" fill="#64748b">
              {step.label}
            </text>
          </g>
        );
      })}
      
      <ArrowMarkers />
    </svg>
  );
};

// Main diagram component
export default function ConcessionsInventoryDiagram() {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [viewMode, setViewMode] = useState('architecture');
  
  const currentPhase = PHASES[currentPhaseIndex];
  
  const handlePrev = () => setCurrentPhaseIndex(Math.max(0, currentPhaseIndex - 1));
  const handleNext = () => setCurrentPhaseIndex(Math.min(PHASES.length - 1, currentPhaseIndex + 1));
  
  return (
    <div className="p-4 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-slate-800">Concessions Inventory System</h1>
          <p className="text-slate-600">Real-time inventory with offline support for high school events</p>
        </div>
        
        {/* View Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setViewMode('architecture')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${viewMode === 'architecture' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
          >
            Architecture
          </button>
          <button
            onClick={() => setViewMode('sequence')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${viewMode === 'sequence' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
          >
            Sequence Diagram
          </button>
        </div>
        
        {/* Phase Selector */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {PHASES.map((phase, idx) => (
            <button
              key={phase.id}
              onClick={() => setCurrentPhaseIndex(idx)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${idx === currentPhaseIndex ? 'bg-slate-800 text-white shadow-lg' : idx < currentPhaseIndex ? 'bg-slate-200 text-slate-700' : 'bg-white text-slate-500 border border-slate-300'}`}
            >
              {phase.label}
            </button>
          ))}
        </div>
        
        {/* Phase Info Card */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-4 border-l-4 border-blue-500">
          <h2 className="font-bold text-lg text-slate-800">{currentPhase.title}</h2>
          <p className="text-slate-600 mb-3">{currentPhase.description}</p>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm text-slate-700 italic">💬 "{currentPhase.sayOutLoud}"</p>
          </div>
        </div>
        
        {/* Diagram */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-4">
          {viewMode === 'architecture' ? (
            <svg width="100%" height="480" viewBox="0 0 880 480">
              <ArrowMarkers />
              
              {/* Swim lane backgrounds */}
              <rect x="40" y="60" width="140" height="300" fill="#f0f9ff" rx="8" opacity="0.5" />
              <text x="110" y="45" textAnchor="middle" fontSize="11" fontWeight="600" fill="#0ea5e9">CLIENTS</text>
              
              <rect x="200" y="60" width="150" height="300" fill="#fefce8" rx="8" opacity="0.5" />
              <text x="275" y="45" textAnchor="middle" fontSize="11" fontWeight="600" fill="#eab308">GATEWAY</text>
              
              <rect x="360" y="60" width="170" height="300" fill="#f0fdf4" rx="8" opacity="0.5" />
              <text x="445" y="45" textAnchor="middle" fontSize="11" fontWeight="600" fill="#22c55e">SERVICES</text>
              
              <rect x="540" y="60" width="150" height="210" fill="#fff7ed" rx="8" opacity="0.5" />
              <text x="615" y="45" textAnchor="middle" fontSize="11" fontWeight="600" fill="#f97316">CACHE</text>
              
              <rect x="540" y="260" width="150" height="200" fill="#faf5ff" rx="8" opacity="0.5" />
              <text x="615" y="250" textAnchor="middle" fontSize="11" fontWeight="600" fill="#8b5cf6">DATA</text>
              
              <rect x="700" y="60" width="150" height="400" fill="#fff7ed" rx="8" opacity="0.5" />
              <text x="775" y="45" textAnchor="middle" fontSize="11" fontWeight="600" fill="#f97316">EXTERNAL</text>
              
              {/* Components */}
              {Object.entries(COMPONENTS).map(([key, comp]) => (
                <ComponentBox 
                  key={key} 
                  comp={comp} 
                  visible={isVisibleInPhase(comp.phase, currentPhase.id)} 
                />
              ))}
              
              {/* Arrows */}
              {ARROWS.map((arrow, idx) => (
                <Arrow 
                  key={idx} 
                  arrow={arrow} 
                  components={COMPONENTS} 
                  visible={isVisibleInPhase(arrow.phase, currentPhase.id)} 
                />
              ))}
            </svg>
          ) : (
            <SequenceDiagram currentPhase={currentPhase.id} />
          )}
        </div>
        
        {/* Navigation */}
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={handlePrev}
            disabled={currentPhaseIndex === 0}
            className={`px-4 py-2 rounded-lg font-medium ${currentPhaseIndex === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
          >
            ← Previous
          </button>
          <span className="text-slate-600">
            Phase {currentPhaseIndex + 1} of {PHASES.length}
          </span>
          <button
            onClick={handleNext}
            disabled={currentPhaseIndex === PHASES.length - 1}
            className={`px-4 py-2 rounded-lg font-medium ${currentPhaseIndex === PHASES.length - 1 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
          >
            Next →
          </button>
        </div>
        
        {/* Legend */}
        <div className="bg-white rounded-xl shadow-md p-4">
          <h3 className="font-bold text-slate-800 mb-3">Legend</h3>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-slate-500"></div>
              <span className="text-sm text-slate-600">Sync Call</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-purple-500" style={{backgroundImage: 'repeating-linear-gradient(90deg, #8b5cf6, #8b5cf6 6px, transparent 6px, transparent 10px)'}}></div>
              <span className="text-sm text-slate-600">Async / Event</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-red-500" style={{backgroundImage: 'repeating-linear-gradient(90deg, #ef4444, #ef4444 6px, transparent 6px, transparent 10px)'}}></div>
              <span className="text-sm text-slate-600">Deep Dive Addition</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-white text-xs font-bold">1</div>
              <span className="text-sm text-slate-600">Request Flow Step</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-6 rounded-full border-2 border-orange-500 bg-orange-50"></div>
              <span className="text-sm text-slate-600">Cache (rounded)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-6 rounded border-2 border-dashed border-red-500 bg-red-50"></div>
              <span className="text-sm text-slate-600">Deep Dive Component</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
