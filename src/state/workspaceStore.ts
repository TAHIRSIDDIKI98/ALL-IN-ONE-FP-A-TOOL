import { create } from 'zustand';
import type { GeneratedFiscalYear } from '../../core/calendar/index.js';
import type { SupportedLocale } from '../../shared/guidance.js';
import type { ScreenUiState } from '../../shared/spine.js';

export interface WorkspaceCompany {
  /** Server-side company id — every authenticated API call is scoped by it. */
  readonly id: string;
  readonly name: string;
  /** ISO-4217 base currency as the SERVER reported it; display only. */
  readonly currency: string;
  readonly calendarKind: '12month' | '445' | '454' | '544' | '52_53' | '13x4';
  readonly fiscalYear: number;
  readonly calendarYears: readonly GeneratedFiscalYear[];
  readonly periodCount: number;
}

export interface WorkspaceStoreState {
  /** Bearer token for the spine API. Memory only: a reload re-authenticates (§3.2). */
  readonly authToken: string | null;
  readonly sessionState: ScreenUiState;
  readonly sessionError: string | null;
  readonly userEmail: string | null;
  readonly company: WorkspaceCompany | null;
  readonly displayLocale: SupportedLocale;
  readonly displayTimeZone: string;
  readonly mappingDecisions: Readonly<Record<string, string>>;
  readonly quarantinedMappings: Readonly<Record<string, string>>;
  readonly setAuthToken: (token: string | null) => void;
  readonly setSessionLoading: () => void;
  readonly setSessionError: (message: string) => void;
  readonly signInSuccess: (email: string) => void;
  readonly signOut: () => void;
  readonly saveCompany: (company: WorkspaceCompany) => void;
  readonly setDisplayLocale: (locale: SupportedLocale) => void;
  readonly setDisplayTimeZone: (timeZone: string) => void;
  readonly mapAccountCode: (sourceCode: string, targetAccountCode: string) => void;
  readonly quarantineAccountCode: (sourceCode: string, reason: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  authToken: null,
  sessionState: 'empty',
  sessionError: null,
  userEmail: null,
  company: null,
  displayLocale: 'en-US',
  displayTimeZone: 'UTC',
  mappingDecisions: {},
  quarantinedMappings: {},

  setAuthToken: (token: string | null) => set({ authToken: token }),
  setSessionLoading: () => set({ sessionState: 'loading', sessionError: null }),
  setSessionError: (message: string) => set({ sessionState: 'error', sessionError: message }),
  signInSuccess: (email: string) => set({ sessionState: 'populated', sessionError: null, userEmail: email }),
  signOut: () =>
    set({
      authToken: null,
      sessionState: 'empty',
      sessionError: null,
      userEmail: null,
      company: null,
      mappingDecisions: {},
      quarantinedMappings: {},
    }),
  saveCompany: (company: WorkspaceCompany) => set({ company }),
  setDisplayLocale: (locale: SupportedLocale) => set({ displayLocale: locale }),
  setDisplayTimeZone: (timeZone: string) => set({ displayTimeZone: timeZone }),
  mapAccountCode: (sourceCode: string, targetAccountCode: string) =>
    set((prev) => ({
      mappingDecisions: { ...prev.mappingDecisions, [sourceCode]: targetAccountCode },
    })),
  quarantineAccountCode: (sourceCode: string, reason: string) =>
    set((prev) => ({
      quarantinedMappings: { ...prev.quarantinedMappings, [sourceCode]: reason },
    })),
}));

