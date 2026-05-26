import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
};

export default function ModalWrapper({ open, onClose, title, subtitle, icon, children }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-3 sm:p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-gradient-to-b from-card to-card/90 p-5 shadow-2xl shadow-primary/[0.04] animate-in zoom-in-95 duration-200 ring-1 ring-border/50 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-transparent via-primary/40 to-transparent pointer-events-none" />
        <button onClick={onClose} className="sticky top-0 z-20 float-right mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-card/80 text-muted-foreground shadow-lg transition-all duration-200 hover:bg-card hover:text-foreground hover:shadow-primary/10 sm:h-8 sm:w-8">
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="mb-4 text-center sm:mb-5">
          {icon && <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/20 sm:h-12 sm:w-12">{icon}</div>}
          <h2 className="text-lg font-bold text-foreground sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
