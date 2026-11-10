// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const pathsOf = (svg: string) =>
  [...svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)].map((match) => match[1]);

const source = read('../../../assets/Zylara_Logo.svg');
const mark = read('../../../public/brand/zylara-mark.svg');
const tile = read('../../../public/brand/zylara-tile.svg');
const appIcon = read('../../../assets/app-icon.svg');
const appIconPng = readFileSync(new URL('../../../app-icon.png', import.meta.url));

describe('brand assets', () => {
  it('deriva o símbolo e o tile exatamente da arte oficial', () => {
    const art = pathsOf(source);

    expect(art).toHaveLength(11);
    expect(pathsOf(mark)).toEqual(art);
    expect(pathsOf(tile)).toEqual(art);
    expect(pathsOf(appIcon)).toEqual(art);
  });

  it('mantém o símbolo sem fundo, recortado à arte', () => {
    expect(mark).toContain('viewBox="18 161 5189 4904"');
    expect(mark).toContain('role="img"');
    expect(mark).toContain('aria-label="Zylara"');
    expect(mark).not.toContain('<rect');
    expect(mark).not.toContain('#EBEBEB');
  });

  it('mantém o tile grafite-claro com cantos arredondados', () => {
    expect(tile).toContain('viewBox="0 0 1254 1254"');
    expect(tile.match(/<rect[^>]*fill="#EBEBEB"/g)).toHaveLength(1);
    expect(tile).toContain('rx="184.412"');
  });

  it('gera o master do ícone com fundo transparente e respiro', () => {
    expect(appIcon).toContain('viewBox="-400 -400 6025 6025"');
    expect(appIcon).not.toContain('<rect');
    expect(appIcon).not.toContain('#EBEBEB');
  });

  it('entrega o master PNG 1024×1024 com canal alfa', () => {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    expect([...appIconPng.subarray(0, 8)]).toEqual(signature);

    // IHDR: width/height are big-endian u32; colour type 6 = RGBA.
    const width = appIconPng.readUInt32BE(16);
    const height = appIconPng.readUInt32BE(20);
    const bitDepth = appIconPng[24];
    const colorType = appIconPng[25];

    expect({ width, height }).toEqual({ width: 1024, height: 1024 });
    expect(bitDepth).toBe(8);
    expect(colorType).toBe(6);
  });
});
