// @vitest-environment jsdom
/**
 * The html and media bodies of the pane. The html frame is the containment
 * boundary for model-written markup, so its sandbox is checked directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HtmlBody, MediaBody } from '../PaneBody';

afterEach(cleanup);

describe('HtmlBody', () => {
  it('runs scripts but never gets allow-same-origin', () => {
    const { container } = render(
      <HtmlBody title="Chart" srcDoc="<script>1</script>" onHide={vi.fn()} />,
    );
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame?.getAttribute('srcdoc')).toBe('<script>1</script>');
  });

  it('the header button hides the pane and keeps the tab', () => {
    const onHide = vi.fn();
    render(<HtmlBody title="Chart" srcDoc="<p/>" onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide preview' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

describe('MediaBody', () => {
  it('shows a picture with pinch-zoom allowed, and a video with inline playback', () => {
    const { container, rerender } = render(
      <MediaBody title="a.png" mediaType="image" src="/files/a.png" onHide={vi.fn()} />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/files/a.png');
    expect(img?.style.touchAction).toBe('pinch-zoom');

    rerender(<MediaBody title="b.mp4" mediaType="video" src="/files/b.mp4" onHide={vi.fn()} />);
    const video = container.querySelector('video');
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
  });

  it('offers the original in a new tab with noopener', () => {
    render(<MediaBody title="a.png" mediaType="image" src="/files/a.png" onHide={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Open original' });
    expect(link.getAttribute('href')).toBe('/files/a.png');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
