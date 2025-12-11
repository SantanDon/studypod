/**
 * RibbonsCursor Component
 * Ribbon cursor trail effect from ReactBits
 * https://reactbits.dev/animations/ribbons
 */

import React, { useEffect, useRef, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
  age: number;
}

interface RibbonsCursorProps {
  enabled?: boolean;
  color?: string;
  ribbonCount?: number;
  maxAge?: number;
  thickness?: number;
  opacity?: number;
}

const RibbonsCursor: React.FC<RibbonsCursorProps> = ({
  enabled = true,
  color = '#667eea',
  ribbonCount = 3,
  maxAge = 50,
  thickness = 20,
  opacity = 0.5,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[][]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);

  const initRibbons = useCallback(() => {
    pointsRef.current = Array.from({ length: ribbonCount }, () => []);
  }, [ribbonCount]);

  useEffect(() => {
    if (!enabled) return;

    initRibbons();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const animate = () => {
      if (!ctx || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      pointsRef.current.forEach((ribbon, ribbonIndex) => {
        // Add new point with offset for each ribbon
        const offset = (ribbonIndex - (ribbonCount - 1) / 2) * 10;
        ribbon.unshift({
          x: mouseRef.current.x + offset,
          y: mouseRef.current.y + offset,
          age: 0,
        });

        // Age and remove old points
        ribbon.forEach((point) => point.age++);
        pointsRef.current[ribbonIndex] = ribbon.filter((point) => point.age < maxAge);

        // Draw ribbon
        if (ribbon.length > 2) {
          ctx.beginPath();
          ctx.moveTo(ribbon[0].x, ribbon[0].y);

          for (let i = 1; i < ribbon.length - 1; i++) {
            const xc = (ribbon[i].x + ribbon[i + 1].x) / 2;
            const yc = (ribbon[i].y + ribbon[i + 1].y) / 2;
            ctx.quadraticCurveTo(ribbon[i].x, ribbon[i].y, xc, yc);
          }

          // Calculate gradient based on ribbon index
          const gradient = ctx.createLinearGradient(
            ribbon[0].x,
            ribbon[0].y,
            ribbon[ribbon.length - 1].x,
            ribbon[ribbon.length - 1].y
          );

          const colors = ['#667eea', '#764ba2', '#c4b5fd'];
          const ribbonColor = colors[ribbonIndex % colors.length];

          gradient.addColorStop(0, `${ribbonColor}00`);
          gradient.addColorStop(0.3, `${ribbonColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`);
          gradient.addColorStop(1, `${ribbonColor}00`);

          ctx.strokeStyle = gradient;
          ctx.lineWidth = thickness * (1 - ribbonIndex * 0.2);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [enabled, color, ribbonCount, maxAge, thickness, opacity, initRibbons]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
};

export default RibbonsCursor;
