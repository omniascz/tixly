'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Stránka {page} z {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="gap-1"
        >
          <ChevronLeft className="h-3 w-3" />
          Předchozí
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="gap-1"
        >
          Další
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
