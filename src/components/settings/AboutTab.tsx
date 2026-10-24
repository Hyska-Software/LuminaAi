import { ExternalLink } from 'lucide-react';
import { BrandMark } from '@/components/chat/BrandMark';
import { catalog, CATALOG_GENERATED_AT } from '@/lib/catalog';
import { openExternal } from '@/lib/genui/open-external';
import { useAppStore } from '@/lib/store';
import { Badge, Button } from '@/components/ui';
import { SettingRow, SettingsSection } from './shared';

const OPENCODE_URL = 'https://opencode.ai';
const CONSOLE_URL = 'https://opencode.ai/console';
/** Repository URL is filled once the public project page exists. */
const REPOSITORY_URL: string | null = null;

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AboutTab() {
  const appInfo = useAppStore((state) => state.appInfo);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Sobre o Lumina" description="Chat desktop local-first com OpenCode Go e Zen.">
        <div className="flex items-center gap-3 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
            <BrandMark size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-foreground">Lumina</p>
            <p className="text-[11px] text-foreground-muted">Tauri 2 · React 19 · Tailwind CSS 4</p>
          </div>
          <Badge tone="accent" size="md">
            v{appInfo?.version ?? '0.1.0'}
          </Badge>
        </div>

        <SettingRow label="Tauri" description="Runtime do aplicativo desktop">
          <span className="font-mono text-xs text-foreground-muted">{appInfo?.tauriVersion ?? '—'}</span>
        </SettingRow>
        <SettingRow label="Plataforma">
          <span className="font-mono text-xs text-foreground-muted">{appInfo?.platform ?? '—'}</span>
        </SettingRow>
        <SettingRow label="Catálogo de modelos" description={`Gerado em ${formatGeneratedAt(CATALOG_GENERATED_AT)}`}>
          <span className="text-xs text-foreground-muted">
            v{catalog.version} · {catalog.providers.reduce((total, provider) => total + provider.models.length, 0)}{' '}
            modelos
          </span>
        </SettingRow>
        <SettingRow label="Armazenamento" description="Local-first: nada sai da sua máquina sem você enviar.">
          <span className="text-xs text-foreground-muted">SQLite + arquivos locais</span>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Links" description="Abre no navegador padrão, nunca dentro do app.">
        <SettingRow label="OpenCode" description="Site oficial dos provedores Go e Zen.">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(OPENCODE_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            Abrir site
          </Button>
        </SettingRow>
        <SettingRow label="Console do OpenCode" description="Gerencie assinatura, créditos e API keys.">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(CONSOLE_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            Abrir console
          </Button>
        </SettingRow>
        <SettingRow
          label="Repositório"
          description={
            REPOSITORY_URL
              ? 'Código-fonte do projeto.'
              : 'Ainda não publicado — o link será adicionado quando o projeto for aberto.'
          }
        >
          <Button size="sm" variant="ghost" disabled title="Repositório ainda não publicado">
            Em breve
          </Button>
        </SettingRow>
      </SettingsSection>

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        Lumina pode cometer erros. Verifique informações importantes. As chaves de API ficam no backend
        local e nunca são expostas à interface.
      </p>
    </div>
  );
}
