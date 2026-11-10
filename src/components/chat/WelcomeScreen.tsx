import { useEffect } from 'react';
import { CodeXml, FilePlus, FileText, Globe, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useReduceMotion } from '@/components/layout/hooks';
import { Kbd } from '@/components/ui';
import { modKey } from '@/lib/utils';
import { BrandMark } from './BrandMark';

const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Suggestion {
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: FileText,
    title: 'Analisar documento',
    description: 'Resuma um PDF, DOCX ou planilha e destaque os pontos principais.',
    prompt: 'Analise o documento em anexo e faça um resumo com os pontos principais.',
  },
  {
    icon: Globe,
    title: 'Pesquisar na web',
    description: 'Busque informações atuais e cite as fontes.',
    prompt: 'Pesquise na web as notícias mais recentes sobre ',
  },
  {
    icon: FilePlus,
    title: 'Criar arquivo',
    description: 'Gere um artefato em Markdown, HTML, CSV ou código.',
    prompt: 'Crie um arquivo Markdown com ',
  },
  {
    icon: CodeXml,
    title: 'Explicar código',
    description: 'Entenda um trecho de código ou encontre a causa de um bug.',
    prompt: 'Explique o que faz o código abaixo e sugira melhorias:\n\n```\n\n```',
  },
];

/** Suggestions fill the composer through a `zylara:suggest` window event. */
function fillComposer(text: string) {
  window.dispatchEvent(new CustomEvent<string>('zylara:suggest', { detail: text }));
}

/** Empty-conversation hero (DESIGN §6.1). */
export function WelcomeScreen() {
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    /* Keep the composer focused when the welcome screen mounts (after the
       composer registered its `zylara:focus-composer` listener). */
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('zylara:focus-composer'));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 pb-8 pt-10 text-center sm:pt-16">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.26, ease: EASE_OUT_SOFT }}
      >
        <span className="relative inline-flex items-center justify-center">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/25 blur-2xl"
          />
          <BrandMark size={64} className="relative" />
        </span>
      </motion.div>

      <h1 className="mt-6 text-[32px] font-semibold tracking-tight text-foreground">Como posso ajudar?</h1>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-foreground-muted">
        Pergunte, pesquise, analise documentos ou crie arquivos com os modelos OpenCode e OpenAI —
        incluindo o uso do seu plano ChatGPT.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion, index) => {
          const Icon = suggestion.icon;
          return (
            <motion.button
              key={suggestion.title}
              type="button"
              onClick={() => fillComposer(suggestion.prompt)}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.24,
                delay: reduceMotion ? 0 : 0.04 * index,
                ease: EASE_OUT_SOFT,
              }}
              className={
                'group flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-left ' +
                'transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
              }
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-foreground-muted transition-colors duration-150 group-hover:text-accent">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-foreground">{suggestion.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-foreground-muted">
                  {suggestion.description}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <p className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-foreground-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
          Comandos
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>{modKey}</Kbd>
          <Kbd>B</Kbd>
          Barra lateral
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          Enviar
        </span>
      </p>
    </div>
  );
}
