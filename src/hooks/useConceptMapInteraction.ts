import { useState, useCallback, useMemo } from 'react';
import { ConceptMap, ConceptNode, NodeType } from '@/types/conceptMap';

export function useConceptMapInteraction(conceptMap: ConceptMap | null, onNodeClick?: (node: ConceptNode) => void) {
  const [scale, setScale] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<ConceptNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [visibleTypes, setVisibleTypes] = useState<Set<NodeType>>(
    new Set(['main', 'subtopic', 'detail', 'term'])
  );
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    if (!conceptMap) return [];
    return conceptMap.nodes.filter((node) => {
      if (!visibleTypes.has(node.type)) return false;
      if (searchQuery && !node.label.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [conceptMap, searchQuery, visibleTypes]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!conceptMap) return [];
    return conceptMap.edges.filter(
      (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
    );
  }, [conceptMap, filteredNodeIds]);

  const connectedNodes = useMemo(() => {
    if (!hoveredNode || !conceptMap) return new Set<string>();
    const connected = new Set<string>([hoveredNode]);
    conceptMap.edges.forEach((edge) => {
      if (edge.source === hoveredNode) connected.add(edge.target);
      if (edge.target === hoveredNode) connected.add(edge.source);
    });
    return connected;
  }, [hoveredNode, conceptMap]);

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(s + 0.15, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(s - 0.15, 0.3));
  }, []);

  const handleReset = useCallback(() => {
    setScale(0.9);
    setPan({ x: 0, y: 0 });
    setSearchQuery('');
    setSelectedNode(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.max(0.3, Math.min(3, s + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && !e.defaultPrevented) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleNodeClick = useCallback(
    (node: ConceptNode, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedNode(node);
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  const toggleNodeType = useCallback((type: NodeType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback((containerRef: React.RefObject<HTMLDivElement>) => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  return {
    scale, setScale,
    pan, setPan,
    isPanning,
    selectedNode, setSelectedNode,
    searchQuery, setSearchQuery,
    isFullscreen,
    showMinimap, setShowMinimap,
    visibleTypes,
    hoveredNode, setHoveredNode,
    filteredNodes,
    filteredEdges,
    connectedNodes,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleNodeClick,
    toggleNodeType,
    toggleFullscreen
  };
}
