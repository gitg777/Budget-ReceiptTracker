// Line icons (24px grid, drawn in the text colour). Decorative: the text beside them carries the meaning.
import type { ReactNode } from 'react';

function Icon({ children, size = 22, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const HomeIcon = (p: P) => <Icon {...p}><path d="M3 11l9-7 9 7v9H3z" /><path d="M10 20v-5h4v5" /></Icon>;
export const ReceiptIcon = (p: P) => <Icon {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></Icon>;
export const ChartIcon = (p: P) => <Icon {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>;
export const PeopleIcon = (p: P) => <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-4 3-6 7-6s7 2 7 6" /><path d="M16 4.5a3.5 3.5 0 010 7M22 20c0-3-1.5-5-4-5.7" /></Icon>;
export const MoreIcon = (p: P) => <Icon {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Icon>;
export const CashIcon = (p: P) => <Icon {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></Icon>;
export const CameraIcon = (p: P) => <Icon {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Icon>;
export const ImageIcon = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Icon>;
export const FileIcon = (p: P) => <Icon {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></Icon>;
export const PencilIcon = (p: P) => <Icon {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /></Icon>;
export const BackIcon = (p: P) => <Icon {...p}><path d="M15 5l-7 7 7 7" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const CloseIcon = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const HelpIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17v.5" /></Icon>;
export const ChatIcon = (p: P) => <Icon {...p}><path d="M4 20l1.4-4A8 8 0 1112 20a8 8 0 01-4-1z" /></Icon>;
export const WarnIcon = (p: P) => <Icon {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></Icon>;
export const CheckIcon = (p: P) => <Icon {...p}><path d="M5 12l5 5 9-10" /></Icon>;
