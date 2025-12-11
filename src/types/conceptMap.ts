export type NodeType = 'main' | 'subtopic' | 'detail' | 'term';

export interface ConceptNode {
  id: string;
  label: string;
  type: NodeType;
  description?: string;
  sourceId?: string;
  x?: number;
  y?: number;
}

export interface ConceptEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: 'related' | 'explains' | 'example' | 'part_of';
}

export interface ConceptMap {
  id: string;
  notebookId: string;
  title: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  createdAt: string;
  updatedAt: string;
}
