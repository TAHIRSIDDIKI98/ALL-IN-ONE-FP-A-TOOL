import type { ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

/**
 * Chart-of-Accounts Mapper (MASTER_PROMPT §9.3.4).
 *
 * The screen exists and is reachable, but the mapping workflow itself is NOT part of this work
 * item: until it lands, an honest empty state states exactly what is missing instead of showing a
 * fabricated mapping table (§1.6-2, §9.2). Unmapped account codes are already quarantined with
 * reasons by the import commit, so nothing is silently dropped while this screen is unavailable.
 */
export default function CoaMapperPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();

  if (forcedState === 'loading') {
    return <LoadingState label="Loading Chart of Accounts mappings..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Chart of Accounts Mapper"
        code="MAP_TARGET_INVALID"
        message="Unable to load the CoA mapping table for the active import batch."
        onRetry={() => onNavigate('/coa-mapper')}
      />
    );
  }

  const signedIn = company !== null && authToken !== null;

  return (
    <EmptyState
      title="Chart of Accounts Mapper"
      disclosure={
        signedIn
          ? 'The interactive account-mapping workflow is not available yet, so there are no mappings to display. Unmapped account codes are quarantined by the import commit with a named reason, and the trial balance only ever reports mapped accounts.'
          : 'Sign in and create a company workspace before mapping source account codes; unmapped codes are quarantined with reasons by the import commit.'
      }
      ctaLabel={signedIn ? 'Open Import Wizard' : 'Go to Sign In'}
      ctaPath={signedIn ? '/import' : '/sign-in'}
      onNavigate={onNavigate}
    />
  );
}
