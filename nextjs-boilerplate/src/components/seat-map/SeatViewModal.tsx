'use client';

import { useState } from 'react';

export interface SeatPhoto {
  id: string;
  photo_url: string;
  view_type: string;
  embed_url: string | null;
  is_360: boolean;
  caption: string | null;
  sector_name: string;
}

interface Props {
  photos: SeatPhoto[];
  seatLabel: string;
  onClose: () => void;
}

export function SeatViewModal({ photos, seatLabel, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const photo = photos[idx];
  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative mx-4 w-full max-w-2xl overflow-hidden rounded-lg bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-3">
          <h3 className="text-sm font-semibold">
            {photo.is_360 ? '360° pohled — ' : 'Pohled ze sedadla — '}
            {seatLabel}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="aspect-video bg-black">
          {photo.is_360 && photo.embed_url ? (
            <iframe
              src={photo.embed_url}
              className="h-full w-full"
              allowFullScreen
              allow="xr-spatial-tracking; gyroscope; accelerometer"
            />
          ) : (
            <img
              src={photo.photo_url}
              alt={photo.caption ?? seatLabel}
              className="h-full w-full object-contain"
            />
          )}
        </div>

        {photo.caption && (
          <p className="px-3 py-1 text-xs text-muted-foreground">{photo.caption}</p>
        )}

        {photos.length > 1 && (
          <div className="flex items-center justify-center gap-2 pb-2 pt-1">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === idx ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
