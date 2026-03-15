import { NodeType } from '@/types/conceptMap';

export const NODE_COLORS: Record<NodeType, { 
  bg: string; 
  bgDark: string;
  border: string; 
  borderDark: string;
  text: string;
  textDark: string;
  glow: string;
}> = {
  main: { 
    bg: '#3b82f6', 
    bgDark: '#2563eb',
    border: '#1d4ed8', 
    borderDark: '#3b82f6',
    text: '#ffffff',
    textDark: '#ffffff',
    glow: 'rgba(59, 130, 246, 0.5)'
  },
  subtopic: { 
    bg: '#10b981', 
    bgDark: '#059669',
    border: '#047857', 
    borderDark: '#10b981',
    text: '#ffffff',
    textDark: '#ffffff',
    glow: 'rgba(16, 185, 129, 0.5)'
  },
  detail: { 
    bg: '#f59e0b', 
    bgDark: '#d97706',
    border: '#b45309', 
    borderDark: '#f59e0b',
    text: '#1f2937',
    textDark: '#ffffff',
    glow: 'rgba(245, 158, 11, 0.5)'
  },
  term: { 
    bg: '#8b5cf6', 
    bgDark: '#7c3aed',
    border: '#6d28d9', 
    borderDark: '#8b5cf6',
    text: '#ffffff',
    textDark: '#ffffff',
    glow: 'rgba(139, 92, 246, 0.5)'
  },
};

export const EDGE_COLORS: Record<string, { stroke: string; strokeDark: string }> = {
  related: { stroke: '#94a3b8', strokeDark: '#64748b' },
  explains: { stroke: '#3b82f6', strokeDark: '#60a5fa' },
  example: { stroke: '#10b981', strokeDark: '#34d399' },
  part_of: { stroke: '#f59e0b', strokeDark: '#fbbf24' },
};

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 55;
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;
export const PADDING = 80;
