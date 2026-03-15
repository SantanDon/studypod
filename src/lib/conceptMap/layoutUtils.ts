import { ConceptNode, ConceptEdge } from '@/types/conceptMap';
import { CANVAS_HEIGHT, CANVAS_WIDTH, NODE_HEIGHT, NODE_WIDTH } from './constants';

export interface NodePosition {
  x: number;
  y: number;
}

export function calculateNodePositions(
  nodes: ConceptNode[],
  edges: ConceptEdge[]
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) return positions;

  const adjacency = new Map<string, Set<string>>();
  const parentMap = new Map<string, string>();
  
  nodes.forEach((node) => adjacency.set(node.id, new Set()));
  edges.forEach(({ source, target }) => {
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
    if (!parentMap.has(target)) {
      parentMap.set(target, source);
    }
  });

  const mainNodes = nodes.filter((n) => n.type === 'main');
  const subtopicNodes = nodes.filter((n) => n.type === 'subtopic');
  const detailNodes = nodes.filter((n) => n.type === 'detail');
  const termNodes = nodes.filter((n) => n.type === 'term');

  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;

  if (mainNodes.length === 1) {
    positions.set(mainNodes[0].id, { x: centerX, y: centerY - 50 });
  } else {
    mainNodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / mainNodes.length - Math.PI / 2;
      const radius = 80;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY - 50 + Math.sin(angle) * radius,
      });
    });
  }

  const subtopicRadius = 180;
  subtopicNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / subtopicNodes.length - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * subtopicRadius,
      y: centerY + Math.sin(angle) * subtopicRadius,
    });
  });

  const detailRadius = 280;
  detailNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / detailNodes.length - Math.PI / 2;
    const jitter = (Math.random() - 0.5) * 30;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * (detailRadius + jitter),
      y: centerY + Math.sin(angle) * (detailRadius + jitter),
    });
  });

  const termRadius = 350;
  termNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / termNodes.length - Math.PI / 2;
    const jitter = (Math.random() - 0.5) * 40;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * (termRadius + jitter),
      y: centerY + Math.sin(angle) * (termRadius + jitter),
    });
  });

  // Force-directed refinement
  for (let iteration = 0; iteration < 100; iteration++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    nodes.forEach((node) => forces.set(node.id, { fx: 0, fy: 0 }));

    nodes.forEach((node) => {
      const pos = positions.get(node.id);
      if (!pos) return;

      nodes.forEach((other) => {
        if (other.id === node.id) return;
        const otherPos = positions.get(other.id);
        if (!otherPos) return;

        const dx = pos.x - otherPos.x;
        const dy = pos.y - otherPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = 160;

        if (dist < minDist) {
          const force = ((minDist - dist) / dist) * 0.3;
          const f = forces.get(node.id)!;
          f.fx += dx * force;
          f.fy += dy * force;
        }
      });
    });

    edges.forEach(({ source, target }) => {
      const sourcePos = positions.get(source);
      const targetPos = positions.get(target);
      if (!sourcePos || !targetPos) return;

      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = 180;

      if (dist > idealDist) {
        const force = ((dist - idealDist) / dist) * 0.05;
        const sf = forces.get(source)!;
        const tf = forces.get(target)!;
        sf.fx += dx * force;
        sf.fy += dy * force;
        tf.fx -= dx * force;
        tf.fy -= dy * force;
      }
    });

    const damping = 1 - iteration / 100;
    nodes.forEach((node) => {
      const pos = positions.get(node.id)!;
      const f = forces.get(node.id)!;
      positions.set(node.id, {
        x: Math.max(NODE_WIDTH, Math.min(CANVAS_WIDTH - NODE_WIDTH, pos.x + f.fx * damping)),
        y: Math.max(NODE_HEIGHT, Math.min(CANVAS_HEIGHT - NODE_HEIGHT, pos.y + f.fy * damping)),
      });
    });
  }

  return positions;
}

export function generateCurvedPath(
  x1: number, y1: number, 
  x2: number, y2: number
): string {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const curveAmount = Math.min(dist * 0.15, 40);
  
  const px = -dy / dist;
  const py = dx / dist;
  
  const ctrlX = midX + px * curveAmount;
  const ctrlY = midY + py * curveAmount;
  
  return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
}
