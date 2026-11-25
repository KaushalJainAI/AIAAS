// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CardField } from '@/api/mcp';
import CardFieldsForm from '../CardFieldsForm';

afterEach(cleanup);

const SUBDOMAIN: CardField = {
  name: 'subdomain',
  label: 'Freshdesk subdomain',
  help: 'The part before .freshdesk.com',
  pattern: '[a-z0-9-]+',
};

const REGION: CardField = {
  name: 'region',
  label: 'Region',
  options: ['us', 'eu', 'in'],
};

describe('CardFieldsForm', () => {
  it('renders a text input with its help text, and a select when options are given', () => {
    render(<CardFieldsForm fields={[SUBDOMAIN, REGION]} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/Freshdesk subdomain/) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('pattern')).toBe('[a-z0-9-]+');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('The part before .freshdesk.com')).toBeTruthy();

    const select = screen.getByLabelText(/Region/) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['', 'us', 'eu', 'in']);
  });

  it('blocks submit when a pattern fails and does not call onSubmit', () => {
    const onSubmit = vi.fn();
    render(<CardFieldsForm fields={[SUBDOMAIN]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Freshdesk subdomain/), {
      target: { value: 'Not Valid!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'Freshdesk subdomain is not in the expected format.',
    );
  });

  it('accepts a value that matches the pattern as a whole', () => {
    const onSubmit = vi.fn();
    render(<CardFieldsForm fields={[SUBDOMAIN]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Freshdesk subdomain/), {
      target: { value: 'acme-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onSubmit).toHaveBeenCalledWith({ subdomain: 'acme-1' });
  });

  it('calls onSubmit with the trimmed values once every field passes', () => {
    const onSubmit = vi.fn();
    render(<CardFieldsForm fields={[SUBDOMAIN, REGION]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Freshdesk subdomain/), {
      target: { value: '  acme-support ' },
    });
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: 'eu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ subdomain: 'acme-support', region: 'eu' });
  });

  it('shows the error it was given, and disables submit while busy', () => {
    const { rerender } = render(
      <CardFieldsForm fields={[SUBDOMAIN]} onSubmit={vi.fn()} error="Subdomain not found" />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Subdomain not found');

    rerender(<CardFieldsForm fields={[SUBDOMAIN]} onSubmit={vi.fn()} busy />);
    const button = screen.getByRole('button', { name: /Connecting/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
