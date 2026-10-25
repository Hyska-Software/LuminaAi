// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  decodeBase64ToBytes,
  formatHexDump,
  formatHexDumpLines,
  HexDump,
} from '@/components/artifacts/HexDump';

afterEach(() => cleanup());

/** 17 bytes: "Hello, world!" + NUL + "AB". */
const SAMPLE_BYTES = new Uint8Array([
  0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x00, 0x41, 0x42,
  0x43,
]);

function base64Of(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

describe('HexDump — formatação', () => {
  it('decodifica base64 e respeita bytes inválidos', () => {
    expect(Array.from(decodeBase64ToBytes(base64Of(SAMPLE_BYTES)))).toEqual(
      Array.from(SAMPLE_BYTES),
    );
    expect(decodeBase64ToBytes(null)).toHaveLength(0);
    expect(decodeBase64ToBytes('*** não é base64 ***')).toHaveLength(0);
  });

  it('formata offset de 8 dígitos, 16 bytes por linha e coluna ASCII', () => {
    const lines = formatHexDump(SAMPLE_BYTES);

    expect(lines).toHaveLength(2);

    expect(lines[0]).toEqual({
      offset: 0,
      offsetHex: '00000000',
      hex: '48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 00 41 42',
      ascii: 'Hello, world!.AB',
      bytes: Array.from(SAMPLE_BYTES.subarray(0, 16)),
    });

    expect(lines[1]).toEqual({
      offset: 16,
      offsetHex: '00000010',
      hex: '43',
      ascii: 'C',
      bytes: [0x43],
    });
  });

  it('substitui bytes não imprimíveis por ponto na coluna ASCII', () => {
    const lines = formatHexDump(new Uint8Array([0x00, 0x1f, 0x20, 0x7e, 0x7f, 0xff]));
    expect(lines).toHaveLength(1);
    expect(lines[0].ascii).toBe('.. ~..');
    expect(lines[0].hex).toBe('00 1f 20 7e 7f ff');
  });

  it('trunca em maxBytes (previewBytes do backend)', () => {
    const lines = formatHexDumpLines(base64Of(SAMPLE_BYTES), 8);
    expect(lines).toHaveLength(1);
    expect(lines[0].hex).toBe('48 65 6c 6c 6f 2c 20 77');
    expect(lines[0].ascii).toBe('Hello, w');
  });

  it('devolve lista vazia para payload vazio', () => {
    expect(formatHexDump(new Uint8Array(0))).toEqual([]);
    expect(formatHexDumpLines('')).toEqual([]);
  });
});

describe('HexDump — componente', () => {
  it('renderiza linhas com offset, hex e ASCII', () => {
    render(<HexDump base64={base64Of(SAMPLE_BYTES)} />);

    const region = screen.getByRole('region', { name: 'Hexdump dos primeiros bytes' });
    expect(region).toBeTruthy();
    expect(screen.getByText('00000000')).toBeTruthy();
    expect(screen.getByText('00000010')).toBeTruthy();
    expect(screen.getByText(/Hello, world!/)).toBeTruthy();
    expect(screen.getByText(/48 65 6c 6c 6f 2c 20 77/)).toBeTruthy();
  });

  it('respeita maxBytes e o rótulo acessível', () => {
    render(<HexDump base64={base64Of(SAMPLE_BYTES)} maxBytes={4} label="Primeiros 4 bytes" />);

    expect(screen.getByRole('region', { name: 'Primeiros 4 bytes' })).toBeTruthy();
    expect(screen.getByText('00000000')).toBeTruthy();
    expect(screen.queryByText('00000010')).toBeNull();
    expect(screen.getByText(/48 65 6c 6c/)).toBeTruthy();
    expect(screen.queryByText(/Hello, world!/)).toBeNull();
  });

  it('mostra estado vazio quando não há bytes', () => {
    render(<HexDump base64="***" />);
    expect(screen.getByText('Nenhum byte para exibir.')).toBeTruthy();
  });
});
