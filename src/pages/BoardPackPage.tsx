import type { ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

/**
 * Board Pack (MASTER_PROMPT §9.3.7).
 *
 * The export pipeline (XLSX/PDF with cross-artifact tie-out, Gate U5/G7) is not part of this work
 * item, so the screen renders an honest empty state instead of a preview assembled from numbers no
 * engine produced (§1.6-1, §9.2). Statements remain the authoritative, drillable source.
 */
export default function BoardPackPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();

  if (forcedState === 'loading') {
    return <LoadingState label="Preparing Board Pack preview..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Board Pack Export"
        code="STATEMENT_TIE_OUT_FAILED"
        message="Export synthesis aborted because statement articulation did not tie cleanly."
        onRetry={() => onNavigate('/board-pack')}
      />
    );
  }

  const signedIn = company !== null && authToken !== null;

  return (
    <EmptyState
      title="Board Pack Export"
      disclosure={
        signedIn
          ? 'Board Pack XLSX/PDF export is not available yet, so there is no artifact to preview. The Statements screen renders the same engine output that the pack will carry, including the A1–A5 articulation checks.'
          : 'Sign in and create a company workspace before previewing a Board Pack; every figure will be the engine’s own.'
      }
      ctaLabel={signedIn ? 'Inspect Statements' : 'Go to Sign In'}
      ctaPath={signedIn ? '/statements' : '/sign-in'}
      onNavigate={onNavigate}
    />
  );
}
