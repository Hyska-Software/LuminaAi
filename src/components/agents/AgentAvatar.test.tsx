// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { AgentAvatar } from './AgentAvatar';
import { DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import type { AgentAvatar as AgentAvatarSpec } from '@/lib/types';

afterEach(cleanup);

function outer(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-avatar-kind]');
  if (!element) throw new Error('avatar não renderizou');
  return element;
}

describe('AgentAvatar', () => {
  it('renderiza o mascote padrão com a cor azul e a forma sem moldura', () => {
    const { container } = render(<AgentAvatar avatar={DEFAULT_AGENT_AVATAR} />);
    const avatar = outer(container);
    expect(avatar.getAttribute('data-avatar-kind')).toBe('mascot');
    expect(avatar.getAttribute('data-avatar-shape')).toBe('mascot');
    expect(avatar.querySelector('svg')).not.toBeNull();
    expect(avatar.querySelector('path')?.getAttribute('fill')).toBe('#5865F2');
    expect(avatar.className).not.toContain('border');
  });

  it('aplica o raio e a moldura do formato círculo', () => {
    const avatar: AgentAvatarSpec = { ...DEFAULT_AGENT_AVATAR, shape: 'circle' };
    const { container } = render(<AgentAvatar avatar={avatar} />);
    const element = outer(container);
    expect(element.className).toContain('rounded-full');
    expect(element.className).toContain('border');
    expect(element.className).toContain('bg-surface-active/70');
  });

  it('renderiza imagem com object-cover em formato e object-contain sem moldura', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const framed = render(
      <AgentAvatar avatar={{ kind: 'image', dataUrl, shape: 'circle' }} />,
    );
    const framedImage = framed.container.querySelector('img');
    expect(framedImage?.getAttribute('src')).toBe(dataUrl);
    expect(framedImage?.className).toContain('object-cover');
    framed.unmount();

    const bare = render(
      <AgentAvatar avatar={{ kind: 'image', dataUrl, shape: 'mascot' }} />,
    );
    expect(bare.container.querySelector('img')?.className).toContain('object-contain');
  });

  it('renderiza o emoji legado', () => {
    const { container } = render(
      <AgentAvatar avatar={{ kind: 'emoji', value: '🛠️', shape: 'rounded' }} />,
    );
    expect(outer(container).textContent).toBe('🛠️');
  });

  it('cai no mascote padrão quando o id do corpo é desconhecido', () => {
    const hostile = {
      ...DEFAULT_AGENT_AVATAR,
      body: 'inexistente',
    } as unknown as AgentAvatarSpec;
    const { container } = render(<AgentAvatar avatar={hostile} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#5865F2');
  });

  it('usa uma única cor de olho, sem pupila, por contraste com o corpo', () => {
    const dark = render(<AgentAvatar avatar={DEFAULT_AGENT_AVATAR} />);
    const darkEyes = Array.from(dark.container.querySelectorAll('svg g ellipse'));
    expect(darkEyes).toHaveLength(2);
    expect(darkEyes.every((eye) => eye.getAttribute('fill') === '#FFFFFF')).toBe(true);
    expect(dark.container.querySelectorAll('svg g circle')).toHaveLength(0);
    dark.unmount();

    const lightAvatar: AgentAvatarSpec = {
      kind: 'mascot',
      shape: 'mascot',
      body: 'mascot',
      expression: 'neutral',
      color: 'yellow',
    };
    const light = render(<AgentAvatar avatar={lightAvatar} />);
    const lightEyes = Array.from(light.container.querySelectorAll('svg g ellipse'));
    expect(lightEyes).toHaveLength(2);
    expect(lightEyes.every((eye) => eye.getAttribute('fill') === '#111114')).toBe(true);
    expect(light.container.querySelectorAll('svg g circle')).toHaveLength(0);
  });

  it('aplica os tamanhos previstos', () => {
    for (const [size, className] of [
      ['sm', 'size-7'],
      ['lg', 'size-14'],
      ['tile', 'size-12'],
      ['xl', 'size-24'],
    ] as const) {
      const { container, unmount } = render(
        <AgentAvatar avatar={DEFAULT_AGENT_AVATAR} size={size} />,
      );
      expect(outer(container).className).toContain(className);
      unmount();
    }
  });
});
