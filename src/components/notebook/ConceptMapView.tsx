import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';

import { ConceptMap, ConceptNode, NodeType } from '@/types/conceptMap';
import { cn } from '@/lib/utils';
import { useConceptMapInteraction } from '@/hooks/useConceptMapInteraction';

interface ConceptMapViewProps {
  conceptMap: ConceptMap | null;
  isLoading?: boolean;
  onNodeClick?: (node: ConceptNode) => void;
}

import { 
  NODE_COLORS, 
  EDGE_COLORS, 
  NODE_WIDTH, 
  NODE_HEIGHT, 
  CANVAS_WIDTH, 
  CANVAS_HEIGHT, 
  PADDING 
} from '@/lib/conceptMap/constants';
import { 
  NodePosition, 
  calculateNodePositions, 
  generateCurvedPath 
} from '@/lib/conceptMap/layoutUtils';

const ConceptMapView: React.FC<ConceptMapViewProps> = ({
  conceptMap,
  isLoading = false,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    scale,
    pan,
    isPanning,
    selectedNode,
    setSelectedNode,
    searchQuery,
    setSearchQuery,
    isFullscreen,
    showMinimap,
    setShowMinimap,
    visibleTypes,
    hoveredNode,
    setHoveredNode,
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
  } = useConceptMapInteraction(conceptMap, onNodeClick);

  const [isDarkMode, setIsDarkMode] = useState(false);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const nodePositions = useMemo(() => {
    if (!conceptMap) return new Map<string, NodePosition>();
    return calculateNodePositions(conceptMap.nodes, conceptMap.edges);
  }, [conceptMap]);

  const exportAsSVG = useCallback(() => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conceptMap?.title || 'concept-map'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [conceptMap?.title]);

  const exportAsPNG = useCallback(() => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH * 2;
    canvas.height = CANVAS_HEIGHT * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = isDarkMode ? '#1f2937' : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conceptMap?.title || 'concept-map'}.png`;
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, [conceptMap?.title, isDarkMode]);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center h-[500px] bg-card">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="relative">
            <i className="fi fi-rr-spinner h-10 w-10 animate-spin text-primary"></i>
            <i className="fi fi-rr-sparkles h-4 w-4 absolute -top-1 -right-1 text-yellow-500 animate-pulse"></i>
          </div>
          <p className="text-sm font-medium">Generating concept map...</p>
          <p className="text-xs">Analyzing relationships between concepts</p>
        </div>
      </Card>
    );
  }

  if (!conceptMap || conceptMap.nodes.length === 0) {
    return (
      <Card className="flex items-center justify-center h-[500px] bg-card">
        <div className="text-center text-muted-foreground">
          <i className="fi fi-rr-map h-12 w-12 mx-auto mb-3 opacity-50"></i>
          <p className="font-medium">No concept map available</p>
          <p className="text-xs mt-1">Generate a concept map from your content</p>
        </div>
      </Card>
    );
  }

  return (
    <Card 
      ref={containerRef}
      className={cn(
        "relative overflow-hidden bg-gradient-to-br transition-all duration-300",
        isDarkMode 
          ? "from-gray-900 via-gray-800 to-gray-900" 
          : "from-slate-50 via-white to-slate-50",
        isFullscreen && "fixed inset-0 z-50 rounded-none"
      )}
    >
      {/* Top toolbar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <i className="fi fi-rr-search absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"></i>
          <Input
            placeholder="Search concepts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm bg-background/80 backdrop-blur-sm"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {/* Filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
                <i className="fi fi-rr-filter h-4 w-4"></i>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Show Node Types
              </div>
              <DropdownMenuSeparator />
              {(['main', 'subtopic', 'detail', 'term'] as NodeType[]).map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={visibleTypes.has(type)}
                  onCheckedChange={() => toggleNodeType(type)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: NODE_COLORS[type].bg }}
                    />
                    <span className="capitalize">{type}</span>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
                <i className="fi fi-rr-download h-4 w-4"></i>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportAsSVG}>
                Export as SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportAsPNG}>
                Export as PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Minimap toggle */}
          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => setShowMinimap(!showMinimap)}
            className="h-8 w-8 bg-background/80 backdrop-blur-sm"
          >
            {showMinimap ? <i className="fi fi-rr-eye-crossed h-4 w-4"></i> : <i className="fi fi-rr-eye h-4 w-4"></i>}
          </Button>

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border">
            <Button variant="ghost" size="icon" onClick={handleZoomOut} className="h-8 w-8 rounded-r-none">
              <i className="fi fi-rr-zoom-out h-4 w-4"></i>
            </Button>
            <span className="px-2 text-xs font-medium min-w-[3rem] text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button variant="ghost" size="icon" onClick={handleZoomIn} className="h-8 w-8 rounded-l-none">
              <i className="fi fi-rr-zoom-in h-4 w-4"></i>
            </Button>
          </div>

          <Button variant="outline" size="icon" onClick={handleReset} className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            <i className="fi fi-rr-rotate-left h-4 w-4"></i>
          </Button>

          <Button variant="outline" size="icon" onClick={() => toggleFullscreen(containerRef)} className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            {isFullscreen ? <i className="fi fi-rr-compress h-4 w-4"></i> : <i className="fi fi-rr-expand h-4 w-4"></i>}
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2">
        {(['main', 'subtopic', 'detail', 'term'] as NodeType[]).map((type) => (
          <Badge
            key={type}
            variant={visibleTypes.has(type) ? "default" : "outline"}
            className={cn(
              "cursor-pointer transition-all text-xs",
              visibleTypes.has(type) && "text-white"
            )}
            style={{
              backgroundColor: visibleTypes.has(type) ? NODE_COLORS[type].bg : 'transparent',
              borderColor: NODE_COLORS[type].bg,
            }}
            onClick={() => toggleNodeType(type)}
          >
            {type} ({conceptMap.nodes.filter(n => n.type === type).length})
          </Badge>
        ))}
      </div>

      {/* Minimap */}
      {showMinimap && (
        <div className="absolute bottom-3 right-3 z-10 w-32 h-20 bg-background/90 backdrop-blur-sm rounded-lg border overflow-hidden">
          <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
            {filteredEdges.map((edge) => {
              const sourcePos = nodePositions.get(edge.source);
              const targetPos = nodePositions.get(edge.target);
              if (!sourcePos || !targetPos) return null;
              return (
                <line
                  key={edge.id}
                  x1={sourcePos.x}
                  y1={sourcePos.y}
                  x2={targetPos.x}
                  y2={targetPos.y}
                  stroke={isDarkMode ? '#4b5563' : '#d1d5db'}
                  strokeWidth={4}
                />
              );
            })}
            {filteredNodes.map((node) => {
              const pos = nodePositions.get(node.id);
              if (!pos) return null;
              return (
                <circle
                  key={node.id}
                  cx={pos.x}
                  cy={pos.y}
                  r={8}
                  fill={isDarkMode ? NODE_COLORS[node.type].bgDark : NODE_COLORS[node.type].bg}
                />
              );
            })}
            {/* Viewport indicator */}
            <rect
              x={-pan.x / scale}
              y={-pan.y / scale}
              width={CANVAS_WIDTH / scale}
              height={CANVAS_HEIGHT / scale}
              fill="none"
              stroke={isDarkMode ? '#60a5fa' : '#3b82f6'}
              strokeWidth={8}
              rx={4}
            />
          </svg>
        </div>
      )}

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-14 left-3 z-10 max-w-xs bg-background/95 backdrop-blur-sm rounded-lg border p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge 
                className="mb-1.5 text-white text-xs"
                style={{ backgroundColor: NODE_COLORS[selectedNode.type].bg }}
              >
                {selectedNode.type}
              </Badge>
              <h4 className="font-semibold text-foreground">{selectedNode.label}</h4>
              {selectedNode.description && (
                <p className="text-xs text-muted-foreground mt-1">{selectedNode.description}</p>
              )}
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 shrink-0"
              onClick={() => setSelectedNode(null)}
            >
              ×
            </Button>
          </div>
        </div>
      )}

      {/* Main SVG canvas */}
      <TooltipProvider delayDuration={200}>
        <svg
          ref={svgRef}
          width="100%"
          height={isFullscreen ? "100%" : "500"}
          className={cn('cursor-grab transition-all', isPanning && 'cursor-grabbing')}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ minHeight: isFullscreen ? '100vh' : '500px' }}
        >
          {/* Background pattern */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path 
                d="M 40 0 L 0 0 0 40" 
                fill="none" 
                stroke={isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} 
                strokeWidth="1"
              />
            </pattern>
            
            {/* Arrow markers for different edge types */}
            {Object.entries(EDGE_COLORS).map(([type, colors]) => (
              <marker
                key={type}
                id={`arrow-${type}`}
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon 
                  points="0 0, 10 3.5, 0 7" 
                  fill={isDarkMode ? colors.strokeDark : colors.stroke} 
                />
              </marker>
            ))}

            {/* Glow filters for nodes */}
            {Object.entries(NODE_COLORS).map(([type, colors]) => (
              <filter key={type} id={`glow-${type}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feFlood floodColor={colors.glow} result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge>
                  <feMergeNode in="shadow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
          </defs>

          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
            {/* Edges */}
            {filteredEdges.map((edge) => {
              const sourcePos = nodePositions.get(edge.source);
              const targetPos = nodePositions.get(edge.target);
              if (!sourcePos || !targetPos) return null;

              const edgeColor = EDGE_COLORS[edge.type] || EDGE_COLORS.related;
              const isHighlighted = connectedNodes.has(edge.source) && connectedNodes.has(edge.target);
              const path = generateCurvedPath(sourcePos.x, sourcePos.y, targetPos.x, targetPos.y);
              
              const midX = (sourcePos.x + targetPos.x) / 2;
              const midY = (sourcePos.y + targetPos.y) / 2;

              return (
                <g key={edge.id} className="transition-opacity duration-200">
                  <path
                    d={path}
                    fill="none"
                    stroke={isDarkMode ? edgeColor.strokeDark : edgeColor.stroke}
                    strokeWidth={isHighlighted ? 3 : 2}
                    strokeOpacity={hoveredNode && !isHighlighted ? 0.2 : 1}
                    markerEnd={`url(#arrow-${edge.type || 'related'})`}
                    className="transition-all duration-200"
                  />
                  {edge.label && (
                    <g transform={`translate(${midX}, ${midY - 10})`}>
                      <rect
                        x={-edge.label.length * 3.5}
                        y={-8}
                        width={edge.label.length * 7}
                        height={16}
                        rx={4}
                        fill={isDarkMode ? 'rgba(31,41,55,0.9)' : 'rgba(255,255,255,0.9)'}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={isDarkMode ? '#9ca3af' : '#6b7280'}
                        style={{ fontSize: '10px' }}
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {filteredNodes.map((node) => {
              const pos = nodePositions.get(node.id);
              if (!pos) return null;

              const colors = NODE_COLORS[node.type];
              const isSelected = selectedNode?.id === node.id;
              const isHovered = hoveredNode === node.id;
              const isConnected = connectedNodes.has(node.id);
              const isHighlighted = isSelected || isHovered || (hoveredNode && isConnected);
              const isDimmed = hoveredNode && !isConnected;

              return (
                <Tooltip key={node.id}>
                  <TooltipTrigger asChild>
                    <g
                      className="cursor-pointer"
                      style={{
                        filter: isHighlighted ? `url(#glow-${node.type})` : undefined,
                        opacity: isDimmed ? 0.3 : 1,
                        transition: 'all 0.2s ease-out',
                      }}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={(e) => handleNodeClick(node, e)}
                    >
                      {/* Node shadow */}
                      <rect
                        x={pos.x - NODE_WIDTH / 2 + 3}
                        y={pos.y - NODE_HEIGHT / 2 + 3}
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={12}
                        fill={isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'}
                      />
                      
                      {/* Node background */}
                      <rect
                        x={pos.x - NODE_WIDTH / 2}
                        y={pos.y - NODE_HEIGHT / 2}
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={12}
                        fill={isDarkMode ? colors.bgDark : colors.bg}
                        stroke={isSelected ? (isDarkMode ? '#ffffff' : '#1f2937') : (isDarkMode ? colors.borderDark : colors.border)}
                        strokeWidth={isSelected ? 3 : 2}
                      />
                      
                      {/* Node label */}
                      <text
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={isDarkMode ? colors.textDark : colors.text}
                        style={{ 
                          fontSize: '12px', 
                          fontWeight: 600,
                          textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                        }}
                        className="pointer-events-none select-none"
                      >
                        {node.label.length > 18
                          ? node.label.slice(0, 16) + '...'
                          : node.label}
                      </text>
                      
                      {/* Type indicator dot */}
                      <circle
                        cx={pos.x + NODE_WIDTH / 2 - 12}
                        cy={pos.y - NODE_HEIGHT / 2 + 12}
                        r={4}
                        fill={isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)'}
                      />
                    </g>
                  </TooltipTrigger>
                  {node.description && (
                    <TooltipContent side="top" className="max-w-[280px] bg-popover">
                      <p className="font-semibold text-foreground mb-1">{node.label}</p>
                      <p className="text-xs text-muted-foreground">{node.description}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </g>
        </svg>
      </TooltipProvider>

      {/* Stats */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-xs text-muted-foreground bg-background/60 backdrop-blur-sm px-3 py-1 rounded-full">
        {filteredNodes.length} nodes · {filteredEdges.length} connections
      </div>
    </Card>
  );
};

export default ConceptMapView;
