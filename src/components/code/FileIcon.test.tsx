// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FILE_ICON_SVG } from '@/lib/fileIconAssets';
import { FileIcon } from './FileIcon';

afterEach(cleanup);

function renderIcon(path: string, className?: string): HTMLElement {
  const { container } = render(<FileIcon path={path} className={className} />);
  const icon = container.querySelector<HTMLElement>('[data-file-icon]');
  if (!icon) throw new Error('FileIcon não renderizou o span decorativo');
  return icon;
}

describe('FileIcon', () => {
  it('resolves the real colored mark for each file type', () => {
    expect(renderIcon('src/app.ts').dataset.fileIcon).toBe('typescript');
    expect(renderIcon('src/main.rs').dataset.fileIcon).toBe('rust');
    expect(renderIcon('docs/doc.pdf').dataset.fileIcon).toBe('pdf');
    expect(renderIcon('README.md').dataset.fileIcon).toBe('readme');
    expect(renderIcon('src/types.d.ts').dataset.fileIcon).toBe('typescript-def');
    expect(renderIcon('package.json').dataset.fileIcon).toBe('nodejs');
    expect(renderIcon('.github/workflows/ci.yml').dataset.fileIcon).toBe(
      'github-actions-workflow',
    );
  });

  it('falls back to the neutral file mark for unknown and empty input', () => {
    expect(renderIcon('assets/blob.qqq').dataset.fileIcon).toBe('file');
    expect(renderIcon('').dataset.fileIcon).toBe('file');
  });

  it('accepts full paths and bare names', () => {
    expect(renderIcon('C:\\repo\\src\\main.rs').dataset.fileIcon).toBe('rust');
    expect(renderIcon('main.rs').dataset.fileIcon).toBe('rust');
  });

  it('renders the internal SVG from the bundled constant', () => {
    const icon = renderIcon('src/app.ts');
    const svg = icon.querySelector('svg');
    expect(svg).toBeTruthy();
    // Colored material-icon-theme mark: the brand fill comes from the asset.
    const fills = [...icon.querySelectorAll<SVGElement>('svg [fill]')].map((node) =>
      node.getAttribute('fill'),
    );
    expect(fills).toContain('#0288d1');
    expect(FILE_ICON_SVG.typescript).toContain('#0288d1');
  });

  it('is decorative and sized in the shared icon box by default', () => {
    const icon = renderIcon('src/main.rs');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.textContent).toBe('');
    expect(icon.className).toContain('inline-flex');
    expect(icon.className).toContain('size-4');
    expect(icon.className).toContain('shrink-0');
    expect(icon.className).toContain('[&>svg]:block');
    expect(icon.className).toContain('[&>svg]:size-full');
  });

  it('lets callers override the size through className', () => {
    const icon = renderIcon('src/app.ts', 'size-3.5');
    expect(icon.className).toContain('size-3.5');
    expect(icon.className).not.toContain('size-4');
  });
});
