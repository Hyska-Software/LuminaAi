/**
 * Lumina UI primitives — public surface used by every feature layer.
 *
 * Conventions:
 * - Tokens only (`bg-surface-raised`, `text-foreground-muted`, …), never raw colors.
 * - Radix under the hood for dropdowns/dialogs/tooltips/tabs/switch/scroll areas.
 * - `cn()` for class merging, visible focus rings, `aria-*` where relevant.
 */
export { Button, buttonSizes, buttonVariants } from './button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button';

export { IconButton } from './icon-button';
export type { IconButtonProps, IconButtonSize } from './icon-button';

export { Spinner } from './spinner';
export type { SpinnerProps, SpinnerSize } from './spinner';

export { Badge } from './badge';
export type { BadgeProps, BadgeSize, BadgeTone, BadgeVariant } from './badge';

export { Kbd } from './kbd';
export type { KbdProps } from './kbd';

export { Label } from './label';
export type { LabelProps } from './label';

export { Input } from './input';
export type { InputProps } from './input';

export { Textarea } from './textarea';
export type { TextareaProps } from './textarea';

export { NativeSelect } from './native-select';
export type { NativeSelectProps } from './native-select';

export { Switch } from './switch';
export type { SwitchProps } from './switch';

export { Slider } from './slider';
export type { SliderProps } from './slider';

export { Separator } from './separator';
export type { SeparatorProps } from './separator';

export { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from './tooltip';
export type { TooltipProps } from './tooltip';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './dialog';
export type { DialogContentProps } from './dialog';

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
export type { DropdownMenuContentProps, DropdownMenuItemProps } from './dropdown-menu';

export { SegmentedControl } from './segmented-control';
export type { SegmentedControlProps, SegmentedOption } from './segmented-control';

export { ScrollArea } from './scroll-area';
export type { ScrollAreaProps } from './scroll-area';

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from './popover';
export type { PopoverContentProps } from './popover';

export { ProgressBar } from './progress-bar';
export type { ProgressBarProps } from './progress-bar';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
export type { TabsListProps, TabsTriggerProps } from './tabs';

export { SortableList, sortableDropClass } from './sortable-list';
export type {
  SortableDropProps,
  SortableItemProps,
  SortableListApi,
  SortableListProps,
} from './sortable-list';
