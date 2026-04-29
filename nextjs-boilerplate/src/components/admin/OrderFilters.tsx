'use client';

import { ChangeEvent } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { AdminEvent, OrderStatus } from '@/types/admin';

export interface OrderFiltersValue {
  eventId: string;
  status: '' | OrderStatus;
  search: string;
  from: string;
  to: string;
}

interface OrderFiltersProps {
  events: AdminEvent[];
  value: OrderFiltersValue;
  onChange: (value: OrderFiltersValue) => void;
}

const statusOptions: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'Všechny stavy' },
  { value: 'paid', label: 'Zaplaceno' },
  { value: 'pending', label: 'Čeká na platbu' },
  { value: 'cancelled', label: 'Zrušeno' },
  { value: 'refunded', label: 'Vráceno' },
  { value: 'expired', label: 'Vypršelo' },
];

export function OrderFilters({ events, value, onChange }: OrderFiltersProps) {
  function patch<K extends keyof OrderFiltersValue>(key: K, v: OrderFiltersValue[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Hledat
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patch('search', e.target.value)}
            placeholder="Jméno nebo e-mail kupujícího"
            className="pl-9"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Akce</label>
        <select
          value={value.eventId}
          onChange={(e) => patch('eventId', e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Všechny akce</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Stav</label>
        <select
          value={value.status}
          onChange={(e) => patch('status', e.target.value as OrderFiltersValue['status'])}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Od</label>
          <Input
            type="date"
            value={value.from}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patch('from', e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Do</label>
          <Input
            type="date"
            value={value.to}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patch('to', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
