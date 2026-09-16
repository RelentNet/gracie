/**
 * Recognise AI-provider failures that staff can't fix by clicking Re-run, and
 * say what to do in plain language (operability rule: never a headline that
 * implies a button guaranteed to fail). Pure and dependency-free so both the
 * worker (alerts) and the browser (Pipeline page) can use it.
 *
 * Matches the provider's error TEXT (the AI SDK surfaces it verbatim), so it
 * works across providers without depending on SDK error classes.
 */
export type AiFailureKind = 'out_of_credits' | 'bad_api_key' | 'rate_limited';

export function classifyAiFailure(message: string | null | undefined): AiFailureKind | null {
  const m = (message ?? '').toLowerCase();
  if (m === '') return null;
  // Checked before rate limits: OpenAI reports an empty quota as HTTP 429 too.
  if (/no credits remaining|insufficient_quota|exceeded your current quota|credit balance is too low|billing hard limit/.test(m)) {
    return 'out_of_credits';
  }
  if (/invalid[ _]api[ _]key|incorrect api key|api key not valid|authentication_error/.test(m)) {
    return 'bad_api_key';
  }
  if (/rate limit|rate_limit|too many requests/.test(m)) return 'rate_limited';
  return null;
}

/** Short alert title per failure kind. */
export const AI_FAILURE_TITLE: Readonly<Record<AiFailureKind, string>> = {
  out_of_credits: 'Gracie’s AI account is out of credits',
  bad_api_key: 'Gracie’s AI key was rejected',
  rate_limited: 'The AI provider was busy',
};

/** Plain-language explanation + the one thing to do. */
export const AI_FAILURE_HEADLINE: Readonly<Record<AiFailureKind, string>> = {
  out_of_credits:
    'Meeting notes can’t be written because Gracie’s AI account is out of credits. An admin needs to add credits with the AI provider (Settings → AI Provider shows which one), then Re-run this meeting.',
  bad_api_key:
    'Meeting notes can’t be written because the AI provider rejected Gracie’s key. An admin needs to update the key in Settings → AI Provider, then Re-run this meeting.',
  rate_limited: 'The AI provider was busy and turned the request away. Re-running in a few minutes usually works.',
};
