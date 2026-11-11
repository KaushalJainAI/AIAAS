// @vitest-environment jsdom
/**
 * The solution form: it refuses to send what the server would refuse, and it
 * reports the share and verified choices with the draft it sends.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import SolutionForm from '../SolutionForm';
import { emptyValues } from '../../../lib/solutionForm';

afterEach(cleanup);

describe('SolutionForm', () => {
  it('does not send while the problem and the fix are empty, and says why', () => {
    const onSubmit = vi.fn();
    render(<SolutionForm mode="new" initial={emptyValues()} submitLabel="Save solution" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save solution' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Describe the problem in a sentence.')).toBeTruthy();
    expect(screen.getByText('Say what fixed it.')).toBeTruthy();
  });

  it('sends the draft, with share on only when the box is ticked', () => {
    const onSubmit = vi.fn();
    render(
      <SolutionForm
        mode="new"
        initial={emptyValues()}
        shareOption
        orgName="Acme"
        submitLabel="Save solution"
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/The problem/), { target: { value: '  Build fails  ' } });
    fireEvent.change(screen.getByLabelText(/What fixed it/), { target: { value: 'Clear the cache' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'ci, windows' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save solution' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      {
        problem: 'Build fails',
        symptoms: '',
        root_cause: '',
        resolution: 'Clear the cache',
        environment: {},
        claims: [],
        tags: ['ci', 'windows'],
      },
      { share: false, verified: false },
    );

    fireEvent.click(screen.getByLabelText(/Share with/));
    fireEvent.click(screen.getByRole('button', { name: 'Save solution' }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.anything(), { share: true, verified: false });
  });

  it('offers "I checked this is still true" only when editing a saved solution', () => {
    const onSubmit = vi.fn();
    const filled = { ...emptyValues(), problem: 'Build fails', resolution: 'Clear it' };
    const { unmount } = render(
      <SolutionForm mode="edit" initial={filled} verifiable submitLabel="Save changes" onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByLabelText(/I checked this is still true/));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.anything(), { share: false, verified: true });
    unmount();

    render(<SolutionForm mode="edit" initial={filled} submitLabel="Save changes" onSubmit={onSubmit} />);
    expect(screen.queryByLabelText(/I checked this is still true/)).toBeNull();
  });

  it('shows the server refusal under the form', () => {
    render(
      <SolutionForm
        mode="new"
        initial={{ ...emptyValues(), problem: 'x', resolution: 'y' }}
        submitLabel="Save solution"
        serverError="Not saved: the fix reads as an instruction to an AI, not a description of a fix."
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('reads as an instruction');
  });

  it('keeps claims hidden until the advanced section is opened, and lists the saved kinds', () => {
    render(<SolutionForm mode="new" initial={emptyValues()} submitLabel="Save solution" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a claim' }));
    const kind = screen.getByLabelText('How fast claim 1 changes') as HTMLSelectElement;
    const values = Array.from(kind.options).map((o) => o.value);
    expect(values).toEqual(['procedure', 'principle', 'versioned', 'config', 'time_sensitive']);
  });
});
