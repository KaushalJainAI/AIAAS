// @vitest-environment jsdom
/**
 * The HTML preview frame's sandbox (preview pane plan, Phase 3).
 *
 * The properties under test: the frame never gets `allow-same-origin` in any
 * mode; "Run scripts" is offered only to the owner of the file; pressing it
 * gives exactly `allow-scripts`; "Turn off" takes it away again.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HtmlFrame } from '../FilePreview';

afterEach(cleanup);

const HTML = '<h1>Chart</h1><script>document.title = "ran"</script>';

function frame(): HTMLIFrameElement {
  return screen.getByTitle('Rendered page.html') as HTMLIFrameElement;
}

describe('HtmlFrame sandbox', () => {
  it('never carries allow-same-origin, in either mode', () => {
    const { unmount } = render(<HtmlFrame html={HTML} title="page.html" isOwner />);
    expect(frame().getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
    fireEvent.click(screen.getByRole('button', { name: 'Run scripts' }));
    expect(frame().getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
    unmount();

    render(<HtmlFrame html={HTML} title="page.html" />);
    expect(frame().getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
  });

  it('starts with no scripts for the owner', () => {
    render(<HtmlFrame html={HTML} title="page.html" isOwner />);
    expect(frame().getAttribute('sandbox')).toBe('');
    expect(screen.getByText(/Scripts and network requests are off/)).toBeTruthy();
  });

  it('pressing Run scripts sets the sandbox to exactly allow-scripts', () => {
    render(<HtmlFrame html={HTML} title="page.html" isOwner />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scripts' }));
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByText('Scripts are on. The page cannot reach the internet or your account.')).toBeTruthy();
    // The CSP inside the document allows inline script and still no network.
    const srcdoc = frame().getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain("script-src 'unsafe-inline'");
    expect(srcdoc).toContain("default-src 'none'");
  });

  it('Turn off returns the frame to an empty sandbox', () => {
    render(<HtmlFrame html={HTML} title="page.html" isOwner />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scripts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(frame().getAttribute('sandbox')).toBe('');
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });
});

describe('HtmlFrame Run scripts button', () => {
  it('is absent when isOwner is false', () => {
    render(<HtmlFrame html={HTML} title="page.html" isOwner={false} />);
    expect(screen.queryByRole('button', { name: 'Run scripts' })).toBeNull();
  });

  it('is absent when isOwner is not given (a shared file, or a response without the flag)', () => {
    render(<HtmlFrame html={HTML} title="page.html" />);
    expect(screen.queryByRole('button', { name: 'Run scripts' })).toBeNull();
    expect(frame().getAttribute('sandbox')).toBe('');
  });
});
