// @vitest-environment jsdom
/**
 * The shared controls carry the flat spec: squared corners, no shadow on
 * buttons or toggles, primary buttons on the primary token with its own text.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';
import { Switch } from '../Switch';
import { IconTile } from '../IconTile';
import { Skeleton } from '../Skeleton';

/** True when the element carries every class named. */
function hasAll(el: Element, ...names: string[]): boolean {
  return names.every((name) => el.classList.contains(name));
}

describe('shared controls', () => {
  it('primary button is the primary token with its own text colour, no shadow', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(hasAll(button, 'bg-primary', 'text-primary-foreground', 'rounded-md')).toBe(true);
    expect(button.className).not.toMatch(/shadow-/);
    expect(button.className).not.toMatch(/rounded-(lg|xl|2xl|full)/);
  });

  it('switch is a squared toggle: 4px track, 3px knob, no knob shadow', () => {
    render(<Switch checked onChange={vi.fn()} label="Notify me" />);
    const track = screen.getByRole('switch', { name: 'Notify me' });
    expect(hasAll(track, 'rounded', 'bg-primary')).toBe(true);
    expect(track.className).not.toMatch(/rounded-full/);
    const knob = track.querySelector('span') as HTMLElement;
    expect(hasAll(knob, 'rounded-[3px]')).toBe(true);
    expect(knob.className).not.toMatch(/shadow/);
  });

  it('icon tile uses the primary-subtle token for the primary tone', () => {
    const { container } = render(<IconTile tone="primary"><span>x</span></IconTile>);
    const tile = container.firstElementChild as HTMLElement;
    expect(hasAll(tile, 'bg-primary-subtle', 'text-primary', 'rounded-md')).toBe(true);
  });

  it('skeleton is a flat pulsing block, not a gradient sweep', () => {
    const { container } = render(<Skeleton />);
    const block = container.firstElementChild as HTMLElement;
    expect(hasAll(block, 'bg-muted', 'animate-pulse', 'rounded-md')).toBe(true);
    expect(block.className).not.toMatch(/gradient/);
  });
});
