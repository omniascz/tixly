'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface OnboardingData {
  completed_steps: number[];
  current_step: number;
  onboarding_done: boolean;
}

const STEPS = [
  { num: 1, label: 'Profil divadla (název, logo, kontakt)' },
  { num: 2, label: 'Přidat sál' },
  { num: 3, label: 'Přidat první inscenaci' },
  { num: 4, label: 'Naplánovat termín' },
  { num: 5, label: 'Nastavit ceny vstupenek' },
  { num: 6, label: 'Bankovní účet pro výplaty', optional: true },
  { num: 7, label: 'Pozvat tým', optional: true },
];

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function OnboardingChecklist() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch('/api/admin/onboarding');
        if (!res.ok) return;
        const json = (await res.json()) as OnboardingData;
        setData(json);
      } catch {
      }
    }
  }, []);

  async function handleSkip() {
    setSkipping(true);
    try {
      await authFetch('/api/admin/onboarding', {
        method: 'POST',
        body: JSON.stringify({ action: 'skip' }),
      });
      setHidden(true);
    } finally {
      setSkipping(false);
    }
  }

  if (!data || data.onboarding_done || hidden) return null;

  const completed = data.completed_steps ?? [];
  const doneCount = completed.length;
  const progressPct = Math.round((doneCount / 7) * 100);

  const currentStep = STEPS.find((s) => !completed.includes(s.num))?.num ?? 7;

  return (
    <div className="mb-6 rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-amber-900">Dokoncete nastaveni divadla</h2>
          <p className="mt-0.5 text-sm text-amber-700">{doneCount}/7 kroku hotovo</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-amber-800">{progressPct} %</span>
      </div>

      <div className="mb-4 h-2 overflow-hidden rounded-full bg-amber-200">
        <div className="h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>

      <ul className="mb-4 space-y-1.5">
        {STEPS.map((s) => {
          const done = completed.includes(s.num);
          return (
            <li key={s.num} className="flex items-center gap-2 text-sm">
              <span className={`shrink-0 text-base ${done ? 'text-emerald-600' : 'text-amber-400'}`}>
                {done ? '✅' : '○'}
              </span>
              <Link
                href={`/admin/onboarding?step=${s.num}`}
                className={`flex-1 hover:underline ${done ? 'text-muted-foreground line-through' : 'text-amber-900'}`}
              >
                {s.label}
                {s.optional && (
                  <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    volitelne
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <Link href={`/admin/onboarding?step=${currentStep}`}>
          <Button className="bg-amber-500 text-white hover:bg-amber-600">
            Pokracovat v nastaveni
          </Button>
        </Link>
        <button
          type="button"
          onClick={handleSkip}
          disabled={skipping}
          className="text-xs text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
        >
          Preskocit nastaveni
        </button>
      </div>
    </div>
  );
}
