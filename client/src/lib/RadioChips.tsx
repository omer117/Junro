import { useRef, type KeyboardEvent } from 'react';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A group of pill buttons of which exactly one is chosen, built the way a radio group should
 * work with the keyboard: the group is ONE stop for the Tab key (the chosen option), and the arrow
 * keys move to the next or previous option (and choose it, unless activation is 'manual'),
 * wrapping around at the ends.
 * Screen readers hear a radio group with its label, and which option is checked.
 */
export function RadioChips<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className = 'mode-chips',
  chipClassName = 'mode-chip',
  activation = 'automatic',
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  chipClassName?: string;
  /**
   * 'automatic': the arrow keys also choose (the usual radio behaviour). 'manual': they only move
   * the focus, and Space or Enter chooses. Use manual when a choice costs something (a new
   * calculation), so moving along the options does not trigger each one.
   */
  activation?: 'automatic' | 'manual';
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent, from: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (from + step + options.length) % options.length;
    refs.current[next]?.focus();
    if (activation === 'automatic') onChange(options[next]!.value);
  };

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Only the chosen option is in the Tab order; the arrow keys reach the others.
            tabIndex={checked ? 0 : -1}
            className={chipClassName}
            disabled={disabled}
            onClick={() => {
              if (!checked) onChange(option.value);
            }}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
