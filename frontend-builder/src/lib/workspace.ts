import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { PageId, Period, Preset, Scenario, Scope, StatementTab } from './data'
import type { DemoIssueId, ImportDraft } from './reviewData'

export type OverlayOptions = { title: string; eyebrow?: string; content: ReactNode; footer?: ReactNode; drawer?: boolean; wide?: boolean }
export type Preferences = { compact: boolean; grouping: boolean; reduceMotion: boolean; guidance: boolean }
export type WorkspaceContext = {
  page: PageId; navigate: (page: PageId) => void;
  workspace: 'sample' | 'blank'; setWorkspace: (value: 'sample' | 'blank') => void;
  workspaceName: string; setWorkspaceName: (name: string) => void;
  scope: Scope; setScope: (scope: Scope) => void;
  period: Period; setPeriod: (period: Period) => void;
  scenario: Scenario; setScenario: (scenario: Scenario) => void;
  statementTab: StatementTab; setStatementTab: (tab: StatementTab) => void;
  consolidationStep: number; setConsolidationStep: (step: number) => void;
  preset: Preset; setPreset: (preset: Preset) => void;
  undoPreset: () => void; redoPreset: () => void; canUndoPreset: boolean; canRedoPreset: boolean;
  importDraft: ImportDraft; setImportDraft: Dispatch<SetStateAction<ImportDraft>>;
  resetImportFlow: () => void; undoImportReset: () => void; canUndoImportReset: boolean;
  inspectedIssues: DemoIssueId[]; toggleInspection: (issue: DemoIssueId) => void;
  activityQuery: string; setActivityQuery: (query: string) => void;
  preferences: Preferences; setPreferences: (preferences: Preferences) => void;
  fmt: (value: number | null | undefined) => string;
  openDialog: (options: OverlayOptions) => void; closeDialog: () => void;
  showAbout: () => void; resetDemo: () => void;
}
export const Workspace = createContext<WorkspaceContext | null>(null)
export function useWorkspace() {
  const context = useContext(Workspace)
  if (!context) throw new Error('Workspace provider is missing')
  return context
}
