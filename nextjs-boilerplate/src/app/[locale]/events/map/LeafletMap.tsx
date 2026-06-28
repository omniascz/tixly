'use client';
/**
 * LeafletMap — načítán pouze v browseru přes dynamic import (ssr: false).
 * Používá react-leaflet + OpenStreetMap tiles (bez API klíče).
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

export interface MapEvent {
  id: string;
  title: string;
  slug: string | null;
  dateStart: string;
  city: string | null;
  venueName: string | null;
  lat: number;
  lng: number;
  eventType: string | null;
  category: string | null;
  coverImage: string | null;
  cheapestPriceHalire: number | null;
  distanceKm: number | null;
}

interface Props {
  events: MapEvent[];
  center: [number, number];
  zoom: number;
  locale: string;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

// Category → barva pinu
const CATEGORY_COLOR: Record<string, string> = {
  music:      '#3b82f6',
  concert:    '#2563eb',
  classical:  '#7c3aed',
  theatre:    '#8b5cf6',
  comedy:     '#f59e0b',
  sport:      '#10b981',
  conference: '#6b7280',
  family:     '#ec4899',
  club:       '#6366f1',
  gastro:     '#f97316',
  exhibition: '#14b8a6',
  education:  '#84cc16',
  online:     '#06b6d4',
};

function pinSvg(color: string, active: boolean): string {
  const r = active ? 14 : 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r * 2}" height="${r * 2 + 6}" viewBox="0 0 ${r * 2} ${r * 2 + 6}">
    <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${color}" stroke="white" stroke-width="2"/>
    <line x1="${r}" y1="${r * 2 - 1}" x2="${r}" y2="${r * 2 + 5}" stroke="${color}" stroke-width="2"/>
  </svg>`;
}

function makeIcon(color: string, active: boolean): L.DivIcon {
  const size = active ? 28 : 22;
  return L.divIcon({
    className: '',
    html: pinSvg(color, active),
    iconSize:    [size, size + 6],
    iconAnchor:  [size / 2, size + 5],
    popupAnchor: [0, -(size + 6)],
  });
}

// Komponenta která sleduje změnu center/zoom a posune mapu
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  const prevCenter = useRef<[number, number] | null>(null);

  useEffect(() => {
    const [lat, lng] = center;
    if (
      prevCenter.current === null ||
      Math.abs(prevCenter.current[0] - lat) > 0.001 ||
      Math.abs(prevCenter.current[1] - lng) > 0.001
    ) {
      map.setView(center, zoom, { animate: true });
      prevCenter.current = center;
    }
  }, [center, zoom, map]);

  return null;
}

function formatPrice(h: number | null): string {
  if (h === null) return '';
  return `od ${(h / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LeafletMap({
  events,
  center,
  zoom,
  locale,
  hoveredId,
  onHover,
}: Props) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
    >
      <MapController center={center} zoom={zoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {events.map((ev) => {
        const color = CATEGORY_COLOR[ev.category ?? ''] ?? CATEGORY_COLOR[ev.eventType ?? ''] ?? '#dc2626';
        const active = hoveredId === ev.id;
        const icon = makeIcon(color, active);
        return (
          <Marker
            key={ev.id}
            position={[ev.lat, ev.lng]}
            icon={icon}
            zIndexOffset={active ? 1000 : 0}
            eventHandlers={{
              mouseover: () => onHover(ev.id),
              mouseout:  () => onHover(null),
            }}
          >
            <Popup maxWidth={260}>
              <div className="space-y-1 text-sm">
                {ev.coverImage ? (
                  <img
                    src={ev.coverImage}
                    alt={ev.title}
                    className="mb-2 h-24 w-full rounded object-cover"
                  />
                ) : null}
                <div className="font-semibold leading-tight">{ev.title}</div>
                <div className="text-xs text-gray-600">
                  {formatDate(ev.dateStart)}
                </div>
                {ev.venueName && (
                  <div className="text-xs text-gray-500">
                    📍 {ev.venueName}{ev.city ? `, ${ev.city}` : ''}
                  </div>
                )}
                {ev.cheapestPriceHalire !== null && (
                  <div className="text-xs font-medium text-emerald-700">
                    {formatPrice(ev.cheapestPriceHalire)}
                  </div>
                )}
                <a
                  href={`/${locale}/events/${ev.slug ?? ev.id}`}
                  className="mt-2 inline-block rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Koupit vstupenky →
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
