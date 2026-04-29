'use client';

import React, { useCallback, useRef, useState, type WheelEvent } from 'react';
import { getSeatColor } from '../../lib/seat-map-parser';
import type { Seat, SeatMap } from '../../types/seat-map';

interface SeatMapSVGProps {
  seatMap: SeatMap;
  selectedSeatIds: Set<string>;
  onSeatClick: (seat: Seat) => void;
}

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export function SeatMapSVG({ seatMap, selectedSeatIds, onSeatClick }: SeatMapSVGProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewState>({ scale: 1, tx: 0, ty: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setView((prev) => {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * delta));
      return { ...prev, scale: newScale };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setView((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleSeatClick = useCallback(
    (e: React.MouseEvent, seat: Seat) => {
      e.stopPropagation(); // prevent pan start on seat click
      if (seat.status !== 'available' && !selectedSeatIds.has(seat.id)) return;
      onSeatClick(seat);
    },
    [onSeatClick, selectedSeatIds],
  );

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-inner">
      <svg
        ref={svgRef}
        viewBox={seatMap.viewBox}
        className="w-full cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        role="img"
        aria-label={`Mapa sálu: ${seatMap.venueName}`}
      >
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
          {/* Stage label */}
          <rect x="250" y="10" width="300" height="40" rx="8" fill="#1e293b" />
          <text
            x="400"
            y="35"
            textAnchor="middle"
            fill="white"
            fontSize="16"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            JEVIŠTĚ
          </text>

          {seatMap.sections.map((section) => (
            <g
              key={section.id}
              transform={section.transform}
              role="group"
              aria-label={`Sekce ${section.name}`}
            >
              {section.seats.map((seat) => {
                const color = getSeatColor(seat);
                const isAvailable = seat.status === 'available';
                const isSelected = selectedSeatIds.has(seat.id);
                const isInteractive = isAvailable || isSelected;
                const isStanding = seat.width === seat.height && seat.width <= 14;

                const commonProps = {
                  key: seat.id,
                  fill: color,
                  stroke: isSelected ? '#1d4ed8' : '#fff',
                  strokeWidth: isSelected ? 2 : 0.5,
                  style: {
                    cursor: isInteractive ? 'pointer' : 'not-allowed',
                    transition: 'fill 0.15s ease, transform 0.1s ease',
                    transformBox: 'fill-box' as const,
                    transformOrigin: 'center' as const,
                  },
                  onClick: (e: React.MouseEvent) => handleSeatClick(e, seat),
                  role: 'button' as const,
                  tabIndex: isInteractive ? 0 : -1,
                  'aria-label': `${seat.section} řada ${seat.row} místo ${seat.seatNumber} — ${seat.zone.price} Kč — ${seat.status}`,
                  'aria-disabled': !isInteractive,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if ((e.key === 'Enter' || e.key === ' ') && isInteractive) {
                      onSeatClick(seat);
                    }
                  },
                };

                return isStanding ? (
                  <circle
                    {...commonProps}
                    cx={seat.x + seat.width / 2}
                    cy={seat.y + seat.height / 2}
                    r={seat.width / 2}
                    className={isInteractive ? 'hover:opacity-80' : ''}
                  >
                    <title>{`${seat.section} řada ${seat.row} místo ${seat.seatNumber} — ${seat.zone.price} Kč`}</title>
                  </circle>
                ) : (
                  <rect
                    {...commonProps}
                    x={seat.x}
                    y={seat.y}
                    width={seat.width}
                    height={seat.height}
                    rx={2}
                    className={isInteractive ? 'hover:opacity-80' : ''}
                  >
                    <title>{`${seat.section} řada ${seat.row} místo ${seat.seatNumber} — ${seat.zone.price} Kč`}</title>
                  </rect>
                );
              })}
            </g>
          ))}
        </g>
      </svg>

      {/* Zoom reset hint */}
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          type="button"
          onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
          className="rounded bg-white/80 px-2 py-1 text-xs text-slate-600 shadow hover:bg-white"
          title="Resetovat zobrazení"
        >
          ⟳ Reset
        </button>
      </div>
    </div>
  );
}
