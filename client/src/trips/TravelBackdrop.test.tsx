import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TravelBackdrop } from './TravelBackdrop';

describe('TravelBackdrop', () => {
  it('is only decoration: hidden from screen readers, with no text and nothing to click', () => {
    const { container } = render(<TravelBackdrop />);

    const backdrop = container.firstElementChild!;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop.textContent).toBe('');
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0);
  });

  it('draws a picture, not an image file to download', () => {
    const { container } = render(<TravelBackdrop />);

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
