import type { ReactNode } from 'react';

interface NoticeProps {
  tone: 'info' | 'success' | 'warning' | 'error';
  children: ReactNode;
}

export function Notice({ tone, children }: NoticeProps) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
