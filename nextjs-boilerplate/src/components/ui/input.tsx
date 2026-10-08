'use client';

import { forwardRef, InputHTMLAttributes, useCallback, useLayoutEffect, useRef, type ChangeEvent } from 'react';
import { cn } from '@/lib/utils';

/** Typy, u kterých se hodnota nepíše (stav nese checked / soubor) — převzetí z DOM se jich netýká. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image']);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => {
    const own = useRef<HTMLInputElement | null>(null);
    const setRef = useCallback((el: HTMLInputElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    }, [ref]);

    // Kolo 16: co uživatel napíše PŘED dokončením hydratace, zůstane v DOM, ale stav formuláře o tom neví — při dalším
    // vykreslení (např. vyplnění hesla) by řízené pole hodnotu přepsalo prázdným stavem. Hned po připojení proto
    // hodnotu z DOM předáme formuláři jeho vlastním onChange, jako by ji uživatel právě napsal. Bez hydratace (pole
    // vykreslené na klientu) se DOM rovná stavu a nic se neděje.
    useLayoutEffect(() => {
      const el = own.current;
      const { value, onChange } = props;
      if (!el || value === undefined || !onChange || NOT_TYPED.has(type)) return;
      const expected = value === null ? '' : String(value);
      if (el.value === expected) return;
      const event = {
        target: el, currentTarget: el, type: 'change', bubbles: true, nativeEvent: new Event('input', { bubbles: true }),
        preventDefault: () => {}, stopPropagation: () => {}, persist: () => {},
        isDefaultPrevented: () => false, isPropagationStopped: () => false,
      } as unknown as ChangeEvent<HTMLInputElement>;
      onChange(event);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <input
        type={type}
        ref={setRef}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
