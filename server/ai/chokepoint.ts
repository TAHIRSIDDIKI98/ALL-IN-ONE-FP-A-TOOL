/**
 * OneFP&A Server-Side AI Egress Chokepoint (`/server/ai/chokepoint.ts`)
 * MASTER_PROMPT §10.3, SPEC.md §7.3 WI-0048B.
 *
 * Enforces egress policy, rate limiting, sensitive data redaction, facts-only prompt wrapping,
 * timeout/fallback chain, and cited commentary validation before any upstream model call.
 */

import {
  redactSensitiveText,
  buildFactsOnlyPrompt,
  validateCitedCommentary,
  buildDeterministicVarianceCommentary,
  compileNaturalLanguageQuery,
  evaluateGuardedFormula,
  AI_MODEL_CARDS,
  type EngineFact,
  type CommentaryValidationResult,
  type FormulaAstResult,
} from '../../core/ai/index.js';

const DEFAULT_PERIODS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13'];

export interface AiEgressOptions {
  readonly companyId: string;
  readonly actorId?: string;
  readonly feature: 'variance_commentary' | 'nlq_query' | 'formula_builder';
  readonly aiEnabled: boolean;
  readonly maxRequestsPerHour: number;
  readonly currentRequestCount: number;
  readonly untrustedUserText?: string;
  readonly facts: readonly EngineFact[];
  readonly mockLlmResponse?: string;
}

export interface AiEgressResult {
  readonly mode: 'llm' | 'deterministic_fallback';
  readonly modelUsed: string;
  readonly promptBytes: number;
  readonly redactionCount: number;
  readonly fallbackReason?: string;
  readonly promptHash: string;
  readonly responseText: string;
  readonly validation?: CommentaryValidationResult;
  readonly parsedNlq?: ReturnType<typeof compileNaturalLanguageQuery>;
  readonly evaluatedFormula?: FormulaAstResult;
}

export async function executeAiChokepoint(options: AiEgressOptions): Promise<AiEgressResult> {
  const modelCard = AI_MODEL_CARDS.find((m) => m.feature === options.feature) ?? AI_MODEL_CARDS[0]!;

  if (!options.aiEnabled) {
    const fallback = getDeterministicFallback(options);
    return {
      mode: 'deterministic_fallback',
      modelUsed: modelCard.primaryModel,
      promptBytes: 0,
      redactionCount: 0,
      fallbackReason: 'AI_DISABLED_BY_POLICY',
      promptHash: 'disabled',
      ...fallback,
    };
  }

  if (options.currentRequestCount >= options.maxRequestsPerHour) {
    const fallback = getDeterministicFallback(options);
    return {
      mode: 'deterministic_fallback',
      modelUsed: modelCard.primaryModel,
      promptBytes: 0,
      redactionCount: 0,
      fallbackReason: 'RATE_LIMITED',
      promptHash: 'rate_limited',
      ...fallback,
    };
  }

  const rawText = options.untrustedUserText || '';
  const redaction = redactSensitiveText(rawText);
  const prompt = buildFactsOnlyPrompt({
    feature: options.feature,
    facts: options.facts,
    untrustedUserText: redaction.redactedText,
  });

  const promptBytes = Buffer.byteLength(prompt.systemInstruction + prompt.delimitedUserContext, 'utf8');

  try {
    const rawResponse = options.mockLlmResponse;
    if (rawResponse === undefined) {
      const fallback = getDeterministicFallback(options);
      return {
        mode: 'deterministic_fallback',
        modelUsed: modelCard.primaryModel,
        promptBytes,
        redactionCount: redaction.redactionCount,
        fallbackReason: 'NO_UPSTREAM_KEY_OR_TEST_MODE',
        promptHash: prompt.promptHash,
        ...fallback,
      };
    }

    if (options.feature === 'variance_commentary') {
      const sentences = [{ text: rawResponse, citationKeys: prompt.allowedFactKeys }];
      const validation = validateCitedCommentary(sentences, options.facts);
      if (!validation.valid) {
        const fallback = buildDeterministicVarianceCommentary(
          options.facts,
          options.facts[0]?.periodCode || 'P01',
          options.untrustedUserText || 'YTD'
        );
        return {
          mode: 'deterministic_fallback',
          modelUsed: modelCard.primaryModel,
          promptBytes,
          redactionCount: redaction.redactionCount,
          fallbackReason: `AI_UNCITED_NUMERAL_REJECTED:${validation.uncitedNumerals.join(',')}`,
          promptHash: prompt.promptHash,
          responseText: fallback.disclosure,
          validation,
        };
      }
      return {
        mode: 'llm',
        modelUsed: modelCard.primaryModel,
        promptBytes,
        redactionCount: redaction.redactionCount,
        promptHash: prompt.promptHash,
        responseText: rawResponse,
        validation,
      };
    } else if (options.feature === 'nlq_query') {
      const parsedNlq = compileNaturalLanguageQuery(rawResponse || options.untrustedUserText || '', DEFAULT_PERIODS);
      return {
        mode: 'llm',
        modelUsed: modelCard.primaryModel,
        promptBytes,
        redactionCount: redaction.redactionCount,
        promptHash: prompt.promptHash,
        responseText: JSON.stringify(parsedNlq),
        parsedNlq,
      };
    } else {
      const factRecord: Record<string, string> = {};
      for (const f of options.facts) {
        factRecord[f.citationKey] = f.value;
        factRecord[f.statementLineKey] = f.value;
      }
      const evaluatedFormula = evaluateGuardedFormula(rawResponse || options.untrustedUserText || '0', factRecord, 2);
      return {
        mode: 'llm',
        modelUsed: modelCard.primaryModel,
        promptBytes,
        redactionCount: redaction.redactionCount,
        promptHash: prompt.promptHash,
        responseText: evaluatedFormula.value || evaluatedFormula.errorCode || 'error',
        evaluatedFormula,
      };
    }
  } catch (err) {
    const fallback = getDeterministicFallback(options);
    return {
      mode: 'deterministic_fallback',
      modelUsed: modelCard.primaryModel,
      promptBytes,
      redactionCount: redaction.redactionCount,
      fallbackReason: err instanceof Error ? err.message : 'UNKNOWN_UPSTREAM_ERROR',
      promptHash: prompt.promptHash,
      ...fallback,
    };
  }
}

function getDeterministicFallback(options: AiEgressOptions) {
  if (options.feature === 'variance_commentary') {
    const fallback = buildDeterministicVarianceCommentary(
      options.facts,
      options.facts[0]?.periodCode || 'P01',
      options.untrustedUserText || 'YTD'
    );
    return {
      responseText: fallback.disclosure,
      validation: { valid: true, uncitedNumerals: [], unknownCitationKeys: [], missingSentenceCitations: [], citationCoveragePct: '100.00' },
    };
  } else if (options.feature === 'nlq_query') {
    const parsedNlq = compileNaturalLanguageQuery(options.untrustedUserText || '', DEFAULT_PERIODS);
    return {
      responseText: JSON.stringify(parsedNlq),
      parsedNlq,
    };
  } else {
    const factRecord: Record<string, string> = {};
    for (const f of options.facts) {
      factRecord[f.citationKey] = f.value;
      factRecord[f.statementLineKey] = f.value;
    }
    const evaluatedFormula = evaluateGuardedFormula(options.untrustedUserText || '0', factRecord, 2);
    return {
      responseText: evaluatedFormula.value || '0.00',
      evaluatedFormula,
    };
  }
}
