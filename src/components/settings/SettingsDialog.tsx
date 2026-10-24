import { useState } from 'react';
import {
  Database,
  Info,
  KeyRound,
  ScrollText,
  Settings2,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '@/lib/store';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { AboutTab } from './AboutTab';
import { DataTab } from './DataTab';
import { GeneralTab } from './GeneralTab';
import { InstructionsTab } from './InstructionsTab';
import { ModelTab } from './ModelTab';
import { ProvidersTab } from './ProvidersTab';
import { ToolsTab } from './ToolsTab';

interface SettingsTabDef {
  value: string;
  label: string;
  icon: LucideIcon;
}

const TABS: SettingsTabDef[] = [
  { value: 'general', label: 'Geral', icon: Settings2 },
  { value: 'providers', label: 'Provedores', icon: KeyRound },
  { value: 'model', label: 'Modelo padrão', icon: Sparkles },
  { value: 'instructions', label: 'Instruções', icon: ScrollText },
  { value: 'tools', label: 'Ferramentas', icon: Wrench },
  { value: 'data', label: 'Dados', icon: Database },
  { value: 'about', label: 'Sobre', icon: Info },
];

/**
 * Settings dialog (DESIGN §9): 860×600, vertical tabs on the left and a
 * scrollable content column on the right. Every change is saved automatically.
 */
export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen);
  const setOpen = useUiStore((state) => state.setSettingsOpen);
  const [tab, setTab] = useState('general');
  const active = TABS.find((entry) => entry.value === tab) ?? TABS[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        className="h-[600px] w-[860px] max-w-[calc(100vw-2rem)] gap-0 p-0"
        aria-describedby={undefined}
      >
        <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex min-h-0 flex-1">
          <div className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
            <div className="px-4 pb-3 pt-5">
              <DialogTitle className="text-[15px]">Configurações</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px]">
                Preferências do Lumina
              </DialogDescription>
            </div>
            <TabsList variant="sidebar" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} variant="sidebar">
                  <Icon aria-hidden className="size-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="border-t border-border p-2">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-3">
              <span className="text-[13px] font-semibold tracking-tight text-foreground">
                {active.label}
              </span>
              <span className="text-[11px] text-foreground-subtle">Salvamento automático</span>
            </div>
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full" type="auto">
                <div className="px-6 py-5">
                  <TabsContent value="general">
                    <GeneralTab />
                  </TabsContent>
                  <TabsContent value="providers">
                    <ProvidersTab />
                  </TabsContent>
                  <TabsContent value="model">
                    <ModelTab />
                  </TabsContent>
                  <TabsContent value="instructions">
                    <InstructionsTab />
                  </TabsContent>
                  <TabsContent value="tools">
                    <ToolsTab />
                  </TabsContent>
                  <TabsContent value="data">
                    <DataTab />
                  </TabsContent>
                  <TabsContent value="about">
                    <AboutTab />
                  </TabsContent>
                </div>
              </ScrollArea>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
