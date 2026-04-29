'use client';

import React from 'react';
import { SeasonPass, SeasonPassStatus } from '../types/season-pass';

// =============================================================================
// PassCard — displays a single season pass with status, usage, and actions
// =============================================================================

interface PassCardProps {
  pass: SeasonPass;
}

const STATUS_STYLES: Record<SeasonPassStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
  suspended: 'bg-amber-100 text-amber-800',
  pending_payment: 'bg-blue-100 text-blue-700',
};

const STATUS_LABELS: Record<SeasonPassStatus, string> = {
  active: 'Aktivní',
  expired: 'Expirovaná',
  cancelled: 'Zrušená',
  suspended: 'Pozastavená',
  pending_payment: 'Čeká na platbu',
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date));
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? 'CZK',
    minimumFractionDigits: 0,
  }).format(amount);
}

function getDaysUntil(date: Date): number {
  const now = new Date();
  const diff = new Date(date).getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function BillingCountdown({ nextBillingDate }: { nextBillingDate: Date }) {
  const days = getDaysUntil(nextBillingDate);
  return (
    <p className="text-sm text-gray-500 mt-1">
      Příští platba za{' '}
      <span className="font-medium text-gray-700">{days} {days === 1 ? 'den' : days < 5 ? 'dny' : 'dní'}</span>
      {' '}({formatDate(nextBillingDate)})
    </p>
  );
}

export function PassCard({ pass }: PassCardProps) {
  const isActive = pass.status === 'active';
  const isFlex = pass.kind === 'flex';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white leading-tight">{pass.name}</h3>
          <p className="text-indigo-200 text-sm mt-0.5">
            {pass.kind === 'season' ? 'Sezónní karta' : 'Flex pass'}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[pass.status]}`}
        >
          {STATUS_LABELS[pass.status]}
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-4 space-y-4">
        {/* Flex pass — remaining uses */}
        {isFlex && pass.remainingUses !== undefined && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-500">Zbývající vstupy</span>
              <span className="text-sm font-medium text-gray-900">
                {pass.remainingUses} / {pass.totalUses ?? '?'}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all"
                style={{
                  width: pass.totalUses
                    ? `${(pass.remainingUses / pass.totalUses) * 100}%`
                    : '0%',
                }}
              />
            </div>
          </div>
        )}

        {/* Season pass — validity range */}
        {pass.kind === 'season' && (
          <div className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">Platnost:</span>{' '}
            {formatDate(pass.startDate)} – {formatDate(pass.endDate)}
          </div>
        )}

        {/* Benefits */}
        <div className="grid grid-cols-3 gap-3 text-center">
          {pass.benefits.addonDiscountPercent > 0 && (
            <div className="bg-indigo-50 rounded-xl p-3">
              <p className="text-lg font-bold text-indigo-700">
                {pass.benefits.addonDiscountPercent}%
              </p>
              <p className="text-xs text-indigo-500 mt-0.5">Sleva na doplňky</p>
            </div>
          )}
          {pass.benefits.earlyAccessHours > 0 && (
            <div className="bg-violet-50 rounded-xl p-3">
              <p className="text-lg font-bold text-violet-700">
                {pass.benefits.earlyAccessHours}h
              </p>
              <p className="text-xs text-violet-500 mt-0.5">Early access</p>
            </div>
          )}
          {pass.benefits.guestPasses > 0 && (
            <div className="bg-fuchsia-50 rounded-xl p-3">
              <p className="text-lg font-bold text-fuchsia-700">
                {pass.benefits.guestPasses}
              </p>
              <p className="text-xs text-fuchsia-500 mt-0.5">Host vstupy</p>
            </div>
          )}
        </div>

        {/* Price */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Cena</span>
          <span className="font-semibold text-gray-900">
            {formatCurrency(pass.price)}
            {pass.billingCycle === 'monthly' && <span className="text-gray-400 font-normal"> / měsíc</span>}
            {pass.billingCycle === 'annual' && <span className="text-gray-400 font-normal"> / rok</span>}
          </span>
        </div>

        {/* Next billing countdown */}
        {isActive && pass.nextBillingDate && pass.billingCycle !== 'one_time' && (
          <BillingCountdown nextBillingDate={pass.nextBillingDate} />
        )}
      </div>

      {/* Footer CTA */}
      {isActive && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <a
            href={`/events?organizerId=${pass.organizerId}`}
            className="block w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm"
          >
            Použít na akci
          </a>
        </div>
      )}

      {pass.status === 'pending_payment' && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-center text-amber-700">
            Čeká na potvrzení platby. Dokončete platbu v GoPay.
          </p>
        </div>
      )}
    </div>
  );
}
