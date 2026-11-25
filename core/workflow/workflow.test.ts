import { describe, expect, it } from 'vitest';
import {
  buildCommentAnchorKey,
  extractMentionTokens,
  resolveMentions,
  transitionApprovalTask,
  type MentionableMember,
} from './index.js';

const NOW = '2026-11-25T20:00:00.000Z';

describe('WI-0034 Pure Collaboration & Workflow Kernel (COL1–COL3, §11.9)', () => {
  it('COL1: enforces the draft -> submitted -> approved | rejected state machine and rejects invalid jumps', () => {
    const submitOk = transitionApprovalTask({
      currentStatus: 'draft',
      nextStatus: 'submitted',
      actorRole: 'editor',
      actorId: 'u-editor',
      occurredAt: NOW,
    });
    expect(submitOk).toEqual({
      ok: true,
      nextStatus: 'submitted',
      decisionReason: null,
      lockPlanVersion: false,
      eventKind: 'approval.submitted',
      stampSubmitted: { by: 'u-editor', at: NOW },
      stampDecided: null,
    });

    const approveOk = transitionApprovalTask({
      currentStatus: 'submitted',
      nextStatus: 'approved',
      actorRole: 'reviewer',
      actorId: 'u-rev',
      reason: 'Reconciled with actuals',
      occurredAt: NOW,
    });
    expect(approveOk).toEqual({
      ok: true,
      nextStatus: 'approved',
      decisionReason: 'Reconciled with actuals',
      lockPlanVersion: true,
      eventKind: 'approval.approved',
      stampSubmitted: null,
      stampDecided: { by: 'u-rev', at: NOW },
    });

    const rejectOk = transitionApprovalTask({
      currentStatus: 'submitted',
      nextStatus: 'rejected',
      actorRole: 'reviewer',
      actorId: 'u-rev',
      reason: 'COGS ratio assumption too low',
      occurredAt: NOW,
    });
    expect(rejectOk.ok).toBe(true);
    if (rejectOk.ok) {
      expect(rejectOk.lockPlanVersion).toBe(false);
      expect(rejectOk.decisionReason).toBe('COGS ratio assumption too low');
      expect(rejectOk.eventKind).toBe('approval.rejected');
    }

    // Negative: draft -> approved direct jump rejected
    const directApprove = transitionApprovalTask({
      currentStatus: 'draft',
      nextStatus: 'approved',
      actorRole: 'owner',
      actorId: 'u-owner',
      occurredAt: NOW,
    });
    expect(directApprove).toEqual({
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: expect.stringContaining('INVALID_TRANSITION'),
    });

    // Negative: rejection without reason fails
    const blankReject = transitionApprovalTask({
      currentStatus: 'submitted',
      nextStatus: 'rejected',
      actorRole: 'reviewer',
      actorId: 'u-rev',
      reason: '   ',
      occurredAt: NOW,
    });
    expect(blankReject).toEqual({
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: expect.stringContaining('REJECTION_REASON_REQUIRED'),
    });

    // Negative: editor cannot approve
    const editorApprove = transitionApprovalTask({
      currentStatus: 'submitted',
      nextStatus: 'approved',
      actorRole: 'editor',
      actorId: 'u-editor',
      occurredAt: NOW,
    });
    expect(editorApprove).toEqual({
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: expect.stringContaining('ROLE_FORBIDDEN'),
    });

    // Negative: approved is locked terminal state
    const approvedToRejected = transitionApprovalTask({
      currentStatus: 'approved',
      nextStatus: 'rejected',
      actorRole: 'owner',
      actorId: 'u-owner',
      reason: 'Changed mind',
      occurredAt: NOW,
    });
    expect(approvedToRejected).toEqual({
      ok: false,
      errorCode: 'MODEL_VERSION_LOCKED',
      reason: expect.stringContaining('LOCKED_WORKFLOW_TASK'),
    });

    // Negative: rejected is terminal for that version
    const rejectedToApproved = transitionApprovalTask({
      currentStatus: 'rejected',
      nextStatus: 'approved',
      actorRole: 'owner',
      actorId: 'u-owner',
      occurredAt: NOW,
    });
    expect(rejectedToApproved).toEqual({
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: expect.stringContaining('INVALID_TRANSITION'),
    });
  });

  it('COL2: builds deterministic canonical comment anchor keys preserving leading zeros and rejects invalid shapes', () => {
    expect(buildCommentAnchorKey({ kind: 'version' })).toEqual({
      ok: true,
      anchor: {
        anchorKind: 'version',
        anchorKey: 'version',
        accountCode: null,
        periodCode: null,
        statementLineKey: null,
      },
    });

    expect(buildCommentAnchorKey({ kind: 'account', accountCode: ' 001200 ' })).toEqual({
      ok: true,
      anchor: {
        anchorKind: 'account',
        anchorKey: 'account:001200',
        accountCode: '001200',
        periodCode: null,
        statementLineKey: null,
      },
    });

    expect(buildCommentAnchorKey({ kind: 'cell', accountCode: '004000', periodCode: 'p03' })).toEqual({
      ok: true,
      anchor: {
        anchorKind: 'cell',
        anchorKey: 'cell:004000:P03',
        accountCode: '004000',
        periodCode: 'P03',
        statementLineKey: null,
      },
    });

    expect(
      buildCommentAnchorKey({ kind: 'statement_line', statementLineKey: 'pl.revenue.service' }),
    ).toEqual({
      ok: true,
      anchor: {
        anchorKind: 'statement_line',
        anchorKey: 'statement:pl.revenue.service',
        accountCode: null,
        periodCode: null,
        statementLineKey: 'pl.revenue.service',
      },
    });

    const badPeriod = buildCommentAnchorKey({
      kind: 'cell',
      accountCode: '4000',
      periodCode: 'INVALID',
    });
    expect(badPeriod.ok).toBe(false);

    const badColon = buildCommentAnchorKey({ kind: 'account', accountCode: '4000:bad' });
    expect(badColon.ok).toBe(false);
  });

  it('COL3: extracts @mentions without false positives on inline emails and validates member uniqueness', () => {
    const members: readonly MentionableMember[] = [
      { userId: 'u1', email: 'alice@onefpa.test', displayName: 'Alice Owner' },
      { userId: 'u2', email: 'bob.cfo@onefpa.test', displayName: 'Bob Reviewer' },
      { userId: 'u3', email: 'sam@onefpa.test', displayName: 'Sam A' },
      { userId: 'u4', email: 'sam@partner.test', displayName: 'Sam B' },
    ];

    const tokens = extractMentionTokens(
      'Please verify billing@vendor.com invoice and notify @alice@onefpa.test plus @bob.cfo (and @alice@onefpa.test again).',
    );
    expect(tokens).toEqual(['alice@onefpa.test', 'bob.cfo']);

    const okRes = resolveMentions(tokens, members);
    expect(okRes).toEqual({
      ok: true,
      recipients: [
        { userId: 'u1', email: 'alice@onefpa.test', displayName: 'Alice Owner' },
        { userId: 'u2', email: 'bob.cfo@onefpa.test', displayName: 'Bob Reviewer' },
      ],
    });

    const unknownRes = resolveMentions(['nobody'], members);
    expect(unknownRes).toEqual({ ok: false, issues: ['UNKNOWN_MENTION:@nobody'] });

    const ambiguousRes = resolveMentions(['sam'], members);
    expect(ambiguousRes).toEqual({ ok: false, issues: ['AMBIGUOUS_MENTION:@sam'] });
  });
});
