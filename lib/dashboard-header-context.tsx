// ABOUTME: Provides route-level control over the shared dashboard header actions.
// ABOUTME: Lets detail pages populate the single top header without rendering a second local header.

'use client';

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type DashboardHeaderContextValue = {
  actions: ReactNode;
  breadcrumbSuffix: ReactNode;
  setActions: (actions: ReactNode) => void;
  setBreadcrumbSuffix: (breadcrumbSuffix: ReactNode) => void;
};

const DashboardHeaderContext = createContext<DashboardHeaderContextValue | null>(null);

export function DashboardHeaderProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  const [breadcrumbSuffix, setBreadcrumbSuffix] = useState<ReactNode>(null);

  return (
    <DashboardHeaderContext.Provider value={{ actions, breadcrumbSuffix, setActions, setBreadcrumbSuffix }}>
      {children}
    </DashboardHeaderContext.Provider>
  );
}

export function useDashboardHeader() {
  const context = useContext(DashboardHeaderContext);
  if (!context) {
    throw new Error('useDashboardHeader must be used within DashboardHeaderProvider');
  }
  return context;
}
