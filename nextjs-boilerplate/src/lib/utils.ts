import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency: 'CZK' | 'EUR' | 'USD' = 'CZK'
): string {
  const formatter = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
  });

  return formatter.format(amount);
}

export function formatDate(date: string | Date, format: string = 'long'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  if (format === 'long') {
    return dateObj.toLocaleDateString('cs-CZ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  if (format === 'short') {
    return dateObj.toLocaleDateString('cs-CZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  if (format === 'time') {
    return dateObj.toLocaleTimeString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return dateObj.toLocaleString('cs-CZ');
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, 'long') + ' ' + formatDate(date, 'time');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '...';
}

export function calculateDaysUntilEvent(eventDate: string | Date): number {
  const date = typeof eventDate === 'string' ? new Date(eventDate) : eventDate;
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

export function isEventActive(startDate: string | Date, endDate: string | Date): boolean {
  const now = new Date();
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  return now >= start && now <= end;
}

export function encodeQueryString(params: Record<string, string | number | boolean>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      searchParams.append(key, String(value));
    }
  });

  return searchParams.toString();
}

export function parseQueryString(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};

  params.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}
