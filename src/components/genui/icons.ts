import {
  ArrowRight,
  Atom,
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Layers,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Whitelist de ícones do contrato (`data/genui-contract.json` → `icons`).
 *
 * O agente só pode citar nomes em kebab-case; este mapa é a única ponte entre
 * esses nomes e o conjunto real de ícones. Manter em sincronia com o contrato —
 * o teste de cobertura em `__tests__/genui-render.test.tsx` falha se faltar
 * algum nome ou se houver nome fora da whitelist.
 */
export const GENUI_ICON_MAP = {
  'arrow-right': ArrowRight,
  calendar: Calendar,
  check: Check,
  'chevron-right': ChevronRight,
  clock: Clock,
  copy: Copy,
  download: Download,
  'external-link': ExternalLink,
  'file-text': FileText,
  globe: Globe,
  lightbulb: Lightbulb,
  'list-checks': ListChecks,
  plus: Plus,
  'refresh-cw': RefreshCw,
  search: Search,
  sparkles: Sparkles,
  atom: Atom,
  'book-open': BookOpen,
  database: Database,
  flame: Flame,
  layers: Layers,
  settings: Settings,
  'shield-check': ShieldCheck,
  target: Target,
  wrench: Wrench,
} satisfies Record<string, LucideIcon>;

export type GenUIIconName = keyof typeof GENUI_ICON_MAP;

/**
 * Resolve um nome de ícone do contrato para o componente lucide correspondente.
 * Nomes fora da whitelist (ou ausentes) retornam `null` e nada é desenhado.
 */
export function genUIIcon(name: string | undefined | null): LucideIcon | null {
  if (!name) return null;
  return (GENUI_ICON_MAP as Record<string, LucideIcon>)[name] ?? null;
}
