import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RadioChips } from './RadioChips';

const OPTIONS = [
  { value: 'a', label: 'Walking' },
  { value: 'b', label: 'Driving' },
  { value: 'c', label: 'Transit' },
] as const;

function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <>
      <button type="button">before</button>
      <RadioChips
        label="Travel mode"
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">after</button>
    </>
  );
}

describe('RadioChips with manual activation', () => {
  it('moves focus with the arrow keys but only chooses on Space or Enter (for choices that cost something)', async () => {
    const onChange = vi.fn();
    render(
      <RadioChips
        label="Travel mode"
        options={OPTIONS}
        value="a"
        onChange={onChange}
        activation="manual"
      />,
    );
    screen.getByRole('radio', { name: 'Walking' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Driving' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('RadioChips', () => {
  it('is a radio group whose chosen option is checked', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'Travel mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Walking' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Driving' })).not.toBeChecked();
  });

  it('is one stop for the Tab key: Tab goes into the group once, and out again', async () => {
    render(<Harness />);

    await userEvent.tab(); // before
    await userEvent.tab(); // the chosen option
    expect(screen.getByRole('radio', { name: 'Walking' })).toHaveFocus();
    await userEvent.tab(); // past the group, not to the next option
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('moves with the arrow keys, choosing as it goes, and wraps around', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('radio', { name: 'Walking' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Driving' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Driving' })).toBeChecked();

    await userEvent.keyboard('{ArrowDown}{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Walking' })).toBeChecked(); // wrapped

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Transit' })).toBeChecked(); // wrapped back
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('can be chosen with a click, too', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Transit' }));

    expect(onChange).toHaveBeenCalledWith('c');
  });
});
