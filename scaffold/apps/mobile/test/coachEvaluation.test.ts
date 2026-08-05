import { describe, expect, it } from 'vitest';
import { coachEvalCases, trainedCoachEvalPack } from '../eval/coachFixtures';
import { evaluateCoachReply, formatCoachEvalFailures } from '../eval/coachEvaluator';
import { fallbackCoachReply, type CoachReply } from '../src/coach/chat';

describe('AI Coach evaluation suite', () => {
  it.each(coachEvalCases)('$id passes the deterministic baseline', (evalCase) => {
    const reply = fallbackCoachReply(evalCase.message, evalCase.pack);
    const result = evaluateCoachReply(evalCase, reply, 'offline');
    expect(result.passed, formatCoachEvalFailures(result)).toBe(true);
  });

  it('detects too many evidence keys and a false plan-mutation claim', () => {
    const badReply: CoachReply = {
      answer: 'I changed your plan and raised your bench target to 275 lb.',
      evidenceKeys: ['latest_pr', 'recovery', 'next_session', 'current_week'],
      followUp: null,
      safetyClass: 'standard',
      boundaryClass: 'fitness',
      source: 'model',
      notice: null,
    };
    const result = evaluateCoachReply(coachEvalCases[0]!, badReply, 'live');
    expect(result.failedChecks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'evidence-count',
      'grounded-measurements',
      'no-mutation-claim',
    ]));
    expect(trainedCoachEvalPack.evidence).toHaveLength(6);
  });

  it('does not treat the same number with a different unit as grounded', () => {
    const reply: CoachReply = {
      answer: 'Volume increased 5%, so add 5 lb next time.',
      evidenceKeys: ['current_week'],
      followUp: null,
      safetyClass: 'standard',
      boundaryClass: 'fitness',
      source: 'model',
      notice: null,
    };
    const result = evaluateCoachReply(coachEvalCases[0]!, reply, 'live');
    const groundingCheck = result.checks.find((check) => check.name === 'grounded-measurements');
    expect(groundingCheck).toMatchObject({ passed: false });
    expect(groundingCheck?.detail).toContain('5 lb');
  });

  it('detects an unnecessary follow-up and a verbose answer on a decision-ready case', () => {
    const evalCase = coachEvalCases.find((item) => item.id === 'concise-programmed-range')!;
    const reply: CoachReply = {
      answer: Array.from({ length: 70 }, () => 'detail').join(' '),
      evidenceKeys: ['next_session'],
      followUp: 'Can you tell me anything else?',
      safetyClass: 'standard',
      boundaryClass: 'fitness',
      source: 'model',
      notice: null,
    };
    const result = evaluateCoachReply(evalCase, reply, 'live');
    expect(result.failedChecks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'answer-concise',
      'follow-up-necessary',
    ]));
  });
});
