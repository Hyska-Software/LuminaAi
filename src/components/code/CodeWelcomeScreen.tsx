import { useEffect } from 'react';
import { Bug, CodeXml, FlaskConical, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useReduceMotion } from '@/components/layout/hooks';

const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface CodeSuggestion {
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
}

const SUGGESTIONS: CodeSuggestion[] = [
  {
    icon: CodeXml,
    title: 'Explique o código',
    description: 'Entenda um trecho e os riscos antes de mexer nele.',
    prompt: 'Explique o que faz o código abaixo e aponte os riscos:\n\n```\n\n```',
  },
  {
    icon: Bug,
    title: 'Encontre um bug',
    description: 'Investigue a causa provável e proponha a correção.',
    prompt: 'Investigue a causa provável deste erro e proponha um plano de correção:\n\n```\n\n```',
  },
  {
    icon: FlaskConical,
    title: 'Escreva testes',
    description: 'Cubra o caminho feliz e os casos de borda.',
    prompt: 'Escreva testes para o código abaixo, cobrindo casos de borda:\n\n```\n\n```',
  },
];

/** Fills the composer through the same event the Chat welcome screen uses. */
function fillComposer(text: string): void {
  window.dispatchEvent(new CustomEvent<string>('lumina:suggest', { detail: text }));
}

/**
 * Empty center of the Code layout (PLAN §3.3/§5): the agent-session welcome
 * with code task suggestions. It fills the composer and never sends by itself.
 */
export function CodeWelcomeScreen() {
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    /* The composer stays mounted when switching Chat ↔ Code; focusing it keeps
       the Code welcome keyboard-first like the Chat one. */
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('lumina:focus-composer'));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 pb-8 pt-10 text-center sm:pt-14">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: EASE_OUT_SOFT }}
        className="flex size-14 items-center justify-center rounded-2xl border border-border bg-surface-raised text-accent shadow-sm"
      >
        <CodeXml aria-hidden className="size-7" strokeWidth={1.75} />
      </motion.div>

      <h1 className="mt-5 text-[28px] font-semibold tracking-tight text-foreground">
        Comece uma sessão do agente
      </h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-foreground-muted">
        Descreva uma tarefa de código — explicar, corrigir, testar ou refatorar. A execução no
        workspace chega com o harness de código.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
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
                'group flex h-full flex-col items-start gap-2 rounded-2xl border border-border bg-surface px-3.5 py-3.5 text-left ' +
                'transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
              }
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-foreground-muted transition-colors duration-150 group-hover:text-accent">
                <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{suggestion.title}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-foreground-muted">
                  {suggestion.description}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default CodeWelcomeScreen;
