import {
  CarProfile,
  ChatsCircle,
  MagnifyingGlass,
  ClipboardText,
  House,
  Sparkle,
  SteeringWheel,
  ShieldCheck,
  Wind,
  Camera,
  Armchair,
  Drop,
  Diamond,
  Info,
  Wrench,
  Car,
  CalendarBlank,
  Clock,
  MapPin,
  Phone,
  Star,
  CheckCircle,
  XCircle,
  HourglassHigh,
  WhatsappLogo,
  TelegramLogo,
  PaperPlaneTilt,
  ArrowRight,
  UserCircle,
  Money,
  SignOut,
  Gear,
  ChartLineUp,
  Plus,
  Trash,
  CalendarPlus,
  BellRinging,
  SquaresFour,
  PencilSimple,
  ArrowCounterClockwise,
  Wallet,
  Check,
  CaretRight,
  DownloadSimple,
} from '@phosphor-icons/react';
import type {Icon} from '@phosphor-icons/react';

/**
 * Иконки студии.
 *
 * Список один: и настройки владельца, и главная страница ссылаются на
 * одни и те же имена. Новый ключ здесь — и он сразу доступен в
 * services[].icon и infoCards[].icon, без правок в разметке.
 */
const REGISTRY = {
  // услуги
  sparkle: Sparkle,
  diamond: Diamond,
  shield: ShieldCheck,
  sofa: Armchair,
  drop: Drop,
  armchair: Armchair,
  car: Car,
  // карточки «почему мы»
  'shield-check': ShieldCheck,
  wind: Wind,
  camera: Camera,
  wrench: Wrench,
  info: Info,
  // интерфейс
  home: House,
  services: SteeringWheel,
  clipboard: ClipboardText,
  calendar: CalendarBlank,
  clock: Clock,
  pin: MapPin,
  phone: Phone,
  star: Star,
  success: CheckCircle,
  error: XCircle,
  pending: HourglassHigh,
  whatsapp: WhatsappLogo,
  telegram: TelegramLogo,
  send: PaperPlaneTilt,
  chat: ChatsCircle,
  search: MagnifyingGlass,
  arrow: ArrowRight,
  user: UserCircle,
  money: Money,
  signout: SignOut,
  gear: Gear,
  chart: ChartLineUp,
  plus: Plus,
  trash: Trash,
  'calendar-plus': CalendarPlus,
  bell: BellRinging,
  grid: SquaresFour,
  edit: PencilSimple,
  undo: ArrowCounterClockwise,
  wallet: Wallet,
  check: Check,
  caret: CaretRight,
  download: DownloadSimple,
  'car-profile': CarProfile,
} as const satisfies Record<string, Icon>;

export type IconName = keyof typeof REGISTRY;

export const ICON_NAMES = Object.keys(REGISTRY) as IconName[];

export function getIcon(name: string | null | undefined): Icon {
  return REGISTRY[(name ?? 'info') as IconName] ?? Info;
}

/** Иконка услуги. */
export function ServiceIcon({name, size = 26}: {name?: string; size?: number}) {
  const Cmp = getIcon(name);
  return <Cmp size={size} weight="duotone" aria-hidden />;
}

/** Иконка по имени — для карточек и навигации. */
export function IconByName({
  name,
  size = 22,
  weight = 'duotone',
  className,
}: {
  name: string;
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  className?: string;
}) {
  const Cmp = getIcon(name);
  return <Cmp size={size} weight={weight} className={className} aria-hidden />;
}
