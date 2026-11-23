// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { browserService } from '@/api/browser';
import LinkTabBody from '../LinkTabBody';

vi.mock('@/api/browser', () => ({
  browserService: {
    preview: vi.fn(),
    frameBlob: vi.fn(),
    status: vi.fn(),
  },
}));

const preview = vi.mocked(browserService.preview);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LinkTabBody', () => {
  it('shows the title, the text excerpt and an Open in new tab link once the preview arrives', async () => {
    preview.mockResolvedValueOnce({
      url: 'https://news.example.test/story',
      title: 'A story',
      frame_id: '',
      text_excerpt: 'The first paragraph of the story.',
    });
    render(<LinkTabBody url="https://news.example.test/story" onHide={vi.fn()} />);

    expect(await screen.findByText('The first paragraph of the story.')).toBeTruthy();
    expect(screen.getByText('A story')).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Open in new tab' });
    expect(open.getAttribute('href')).toBe('https://news.example.test/story');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('No picture was kept for this page.')).toBeTruthy();
  });

  it('says the rate limit in plain words on a 429', async () => {
    preview.mockRejectedValueOnce({ response: { status: 429, data: { detail: 'Request was throttled.' } } });
    render(<LinkTabBody url="https://limit.example.test/a" onHide={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Too many previews this hour. Try again later.');
  });

  it('says previews are not set up on a 404, not the server\'s "Not found."', async () => {
    preview.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Not found.' } } });
    render(<LinkTabBody url="https://off.example.test/a" onHide={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Link previews are not set up on this server.'),
    );
  });

  it('shows the server\'s reason for a refused address (400)', async () => {
    preview.mockRejectedValueOnce({ response: { status: 400, data: { error: 'That address is not allowed.' } } });
    render(<LinkTabBody url="http://10.0.0.1/a" onHide={vi.fn()} />);
    expect(await screen.findByText('That address is not allowed.')).toBeTruthy();
  });

  it('asks the server once for a link, and not again when the tab is shown again', async () => {
    preview.mockResolvedValue({ url: 'https://once.example.test/', title: 'Once', frame_id: '', text_excerpt: 'x' });
    const { unmount } = render(<LinkTabBody url="https://once.example.test/" onHide={vi.fn()} />);
    await screen.findByText('Once');
    unmount();
    render(<LinkTabBody url="https://once.example.test/" onHide={vi.fn()} />);
    await screen.findByText('Once');
    expect(preview).toHaveBeenCalledTimes(1);
  });
});
