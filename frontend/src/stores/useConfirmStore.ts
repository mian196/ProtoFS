import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  tip?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  icon?: 'trash' | 'shield' | 'alert' | 'info';
  defaultFocus?: 'confirm' | 'cancel';
}

interface ConfirmState {
  isOpen: boolean;
  options: ConfirmOptions | null;
  resolver: ((val: boolean) => void) | null;
  open: (options: ConfirmOptions, resolver: (val: boolean) => void) => void;
  confirmAction: () => void;
  cancelAction: () => void;
  close: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  isOpen: false,
  options: null,
  resolver: null,

  open: (options, resolver) => {
    const currentResolver = get().resolver;
    if (currentResolver) {
      currentResolver(false);
    }
    set({
      isOpen: true,
      options,
      resolver,
    });
  },

  confirmAction: () => {
    const resolver = get().resolver;
    if (resolver) resolver(true);
    set({ isOpen: false, options: null, resolver: null });
  },

  cancelAction: () => {
    const resolver = get().resolver;
    if (resolver) resolver(false);
    set({ isOpen: false, options: null, resolver: null });
  },

  close: () => {
    const resolver = get().resolver;
    if (resolver) resolver(false);
    set({ isOpen: false, options: null, resolver: null });
  },
}));

/**
 * Global promise-based confirmation dialog trigger.
 * Replaces window.confirm with an animated, themed, accessible WebUI modal.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().open(options, resolve);
  });
}
