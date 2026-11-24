import { create } from 'zustand';
import type { GeneratedFiscalYear } from '../../core/calendar/index.js';
import type { MessyImportResult } from '../../core/import/index.js';
import type { ScreenUiState } from '../../shared/spine.js';

export interface WorkspaceCompany {
  readonly name: string;
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'INR' | 'KWD';
  readonly calendarKind: '12month' | '445' | '454' | '544' | '52_53' | '13x4';
  readonly fiscalYear: number;
  readonly calendarYears: readonly GeneratedFiscalYear[];
}

export interface WorkspaceStoreState {
  readonly sessionState: ScreenUiState;
  readonly sessionError: string | null;
  readonly userEmail: string | null;
  readonly company: WorkspaceCompany | null;
  readonly lastImport: MessyImportResult | null;
  readonly mappingDecisions: Readonly<Record<string, string>>;
  readonly quarantinedMappings: Readonly<Record<string, string>>;
  readonly setSessionLoading: () => void;
  readonly setSessionError: (message: string) => void;
  readonly signInSuccess: (email: string) => void;
  readonly signOut: () => void;
  readonly saveCompany: (company: WorkspaceCompany) => void;
  readonly saveImportResult: (result: MessyImportResult) => void;
  readonly mapAccountCode: (sourceCode: string, targetAccountCode: string) => void;
  readonly quarantineAccountCode: (sourceCode: string, reason: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  sessionState: 'empty',
  sessionError: null,
  userEmail: null,
  company: null,
  lastImport: null,
  mappingDecisions: {},
  quarantinedMappings: {},

  setSessionLoading: () => set({ sessionState: 'loading', sessionError: null }),
  setSessionError: (message: string) => set({ sessionState: 'error', sessionError: message }),
  signInSuccess: (email: string) => set({ sessionState: 'populated', sessionError: null, userEmail: email }),
  signOut: () =>
    set({
      sessionState: 'empty',
      sessionError: null,
      userEmail: null,
      company: null,
      lastImport: null,
      mappingDecisions: {},
      quarantinedMappings: {},
    }),
  saveCompany: (company: WorkspaceCompany) => set({ company }),
  saveImportResult: (result: MessyImportResult) => set({ lastImport: result }),
  mapAccountCode: (sourceCode: string, targetAccountCode: string) =>
    set((prev) => ({
      mappingDecisions: { ...prev.mappingDecisions, [sourceCode]: targetAccountCode },
    })),
  quarantineAccountCode: (sourceCode: string, reason: string) =>
    set((prev) => ({
      quarantinedMappings: { ...prev.quarantinedMappings, [sourceCode]: reason },
    })),
}));
