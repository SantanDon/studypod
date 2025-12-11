import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface GlareCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export const GlareCard = ({ children, className, ...props }: GlareCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [glareStyle, setGlareStyle] = useState({});

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setGlareStyle({
      background: `radial-gradient(
        600px circle at ${x}px ${y}px,
        rgba(255, 255, 255, 0.4),
        transparent 40%
      )`,
    });
  };

  const handleMouseLeave = () => {
    setGlareStyle({
      background: 'transparent',
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow transition-all duration-200',
        className
      )}
      {...props}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={glareStyle}
      />
      <div className="relative z-10">{children}</div>
      {/* Glare overlay */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
        style={{
            ...glareStyle,
            opacity: Object.keys(glareStyle).length > 1 ? 1 : 0
        }}
      />
    </div>
  );
};
