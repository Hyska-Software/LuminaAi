import { cn } from '@/lib/utils';

export type BrandMarkVariant = 'mark' | 'tile';

export interface BrandMarkProps {
  /** Altura da marca em pixels. A variante `tile` é quadrada. */
  size?: number;
  /**
   * `mark` — símbolo oficial sem fundo, para uso inline (titlebar, avatar,
   * boas-vindas, splash, Sobre). `tile` — ícone oficial completo, com o tile
   * grafite-claro, para contextos que representam o app (ícones do SO, favicon).
   */
  variant?: BrandMarkVariant;
  className?: string;
  /** Pulso suave usado enquanto o assistente raciocina. */
  animated?: boolean;
}

const SOURCES: Record<BrandMarkVariant, string> = {
  mark: '/brand/lumina-mark.svg',
  tile: '/brand/lumina-tile.svg',
};

/**
 * Marca oficial da Lumina (DESIGN §2).
 *
 * Os vetores vivem em `public/brand/` e derivam dos assets originais:
 * `lumina-mark.svg` é o símbolo sem fundo (recortado à arte) e
 * `lumina-tile.svg` é o ícone completo com o tile grafite-claro. Renderizar
 * como `<img>` mantém a arte fora do bundle JS e nítida em qualquer tamanho.
 */
export function BrandMark({ size = 24, variant = 'mark', className, animated = false }: BrandMarkProps) {
  const square = variant === 'tile';
  return (
    <img
      src={SOURCES[variant]}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('shrink-0 select-none', animated && 'animate-pulse-soft', className)}
      style={
        square
          ? { width: size, height: size }
          : { height: size, width: 'auto' }
      }
    />
  );
}
