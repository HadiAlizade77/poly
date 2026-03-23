import { describe, it, expect } from 'vitest';
import { parseAiResponse, AiDecisionSchema, type ParsedDecision } from '../../../src/services/ai/response-parser.js';

// ─── Valid decision payloads ───────────────────────────────────────────────────

const VALID_HOLD: ParsedDecision = {
  action: 'hold',
  direction: null,
  outcome_token: null,
  confidence: 0.3,
  size_hint: null,
  fair_value: null,
  estimated_edge: null,
  reasoning: 'Insufficient signal to trade.',
  regime_assessment: 'neutral',
};

const VALID_TRADE: ParsedDecision = {
  action: 'trade',
  direction: 'buy',
  outcome_token: 'YES',
  confidence: 0.75,
  size_hint: 0.10,
  fair_value: 0.70,
  estimated_edge: 0.05,
  reasoning: 'Strong uptrend signal detected.',
  regime_assessment: 'bullish',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toJson(obj: unknown): string {
  return JSON.stringify(obj);
}

function toFence(obj: unknown, lang = 'json'): string {
  return `\`\`\`${lang}\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
}

// ─── Valid JSON parsing ────────────────────────────────────────────────────────

describe('parseAiResponse – valid JSON', () => {
  it('parses a plain JSON hold decision', () => {
    const result = parseAiResponse(toJson(VALID_HOLD));
    expect(result.action).toBe('hold');
    expect(result.confidence).toBe(0.3);
    expect(result.reasoning).toBe('Insufficient signal to trade.');
  });

  it('parses a plain JSON trade decision', () => {
    const result = parseAiResponse(toJson(VALID_TRADE));
    expect(result.action).toBe('trade');
    expect(result.direction).toBe('buy');
    expect(result.outcome_token).toBe('YES');
    expect(result.confidence).toBe(0.75);
  });

  it('parses JSON wrapped in ```json code fence', () => {
    const result = parseAiResponse(toFence(VALID_HOLD, 'json'));
    expect(result.action).toBe('hold');
    expect(result.reasoning).toBeTruthy();
  });

  it('parses JSON wrapped in plain ``` code fence (no language tag)', () => {
    const result = parseAiResponse(toFence(VALID_HOLD, ''));
    expect(result.action).toBe('hold');
  });

  it('ignores surrounding prose and extracts the JSON object', () => {
    const raw = `Here is my analysis:\n\n${toJson(VALID_HOLD)}\n\nEnd of analysis.`;
    const result = parseAiResponse(raw);
    expect(result.action).toBe('hold');
  });

  it('parses action=sell direction', () => {
    const payload = { ...VALID_TRADE, direction: 'sell' };
    const result = parseAiResponse(toJson(payload));
    expect(result.direction).toBe('sell');
  });

  it('accepts null optional fields', () => {
    const minimal = {
      action: 'hold',
      confidence: 0.5,
      reasoning: 'No signal.',
    };
    const result = parseAiResponse(toJson(minimal));
    expect(result.action).toBe('hold');
    expect(result.confidence).toBe(0.5);
  });

  it('returns result with all schema fields present', () => {
    const result = parseAiResponse(toJson(VALID_TRADE));
    const keys = ['action', 'confidence', 'reasoning'];
    for (const key of keys) {
      expect(result).toHaveProperty(key);
    }
  });
});

// ─── Markdown fence variations ────────────────────────────────────────────────

describe('parseAiResponse – markdown fences', () => {
  it('strips ```json fences before JSON parse', () => {
    const text = `\`\`\`json\n${toJson(VALID_TRADE)}\n\`\`\``;
    const result = parseAiResponse(text);
    expect(result.action).toBe('trade');
    expect(result.direction).toBe('buy');
  });

  it('strips ``` fences (no language tag)', () => {
    const text = `\`\`\`\n${toJson(VALID_TRADE)}\n\`\`\``;
    const result = parseAiResponse(text);
    expect(result.action).toBe('trade');
  });

  it('extracts JSON even with whitespace inside fences', () => {
    const text = `\`\`\`json\n  \n${toJson(VALID_HOLD)}  \n\`\`\``;
    const result = parseAiResponse(text);
    expect(result.action).toBe('hold');
  });
});

// ─── Invalid JSON ─────────────────────────────────────────────────────────────

describe('parseAiResponse – invalid JSON', () => {
  it('throws when response is not valid JSON', () => {
    expect(() => parseAiResponse('This is just prose, not JSON.')).toThrow(/not valid JSON/);
  });

  it('throws on truncated JSON', () => {
    expect(() => parseAiResponse('{"action": "hold", "confidence')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseAiResponse('')).toThrow();
  });

  it('throws on JSON array (not object)', () => {
    expect(() => parseAiResponse('["hold", "buy"]')).toThrow();
  });
});

// ─── Schema validation failures ───────────────────────────────────────────────

describe('parseAiResponse – schema validation', () => {
  it('throws when action field is missing', () => {
    const bad = { confidence: 0.5, reasoning: 'test' };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when action is an unknown value', () => {
    const bad = { ...VALID_HOLD, action: 'skip' };
    expect(() => parseAiResponse(toJson(bad))).toThrow();
  });

  it('throws when reasoning is empty string', () => {
    const bad = { ...VALID_HOLD, reasoning: '' };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when reasoning is missing', () => {
    const { reasoning: _, ...bad } = VALID_HOLD;
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when confidence is > 1', () => {
    const bad = { ...VALID_HOLD, confidence: 1.5 };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when confidence is < 0', () => {
    const bad = { ...VALID_HOLD, confidence: -0.1 };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when confidence is missing', () => {
    const { confidence: _, ...bad } = VALID_HOLD;
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when action=trade but direction is missing', () => {
    const bad = { ...VALID_TRADE, direction: undefined };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/action=trade but no direction/);
  });

  it('throws when action=trade but direction is null', () => {
    const bad = { ...VALID_TRADE, direction: null };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/action=trade but no direction/);
  });

  it('does NOT throw when action=hold and direction is null', () => {
    const valid = { ...VALID_HOLD, direction: null };
    expect(() => parseAiResponse(toJson(valid))).not.toThrow();
  });

  it('throws when size_hint is out of range (> 1)', () => {
    const bad = { ...VALID_HOLD, size_hint: 1.5 };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });

  it('throws when estimated_edge is out of range (< -1)', () => {
    const bad = { ...VALID_HOLD, estimated_edge: -1.5 };
    expect(() => parseAiResponse(toJson(bad))).toThrow(/validation failed/);
  });
});

// ─── AiDecisionSchema direct tests ───────────────────────────────────────────

describe('AiDecisionSchema', () => {
  it('accepts a minimal valid hold decision', () => {
    const result = AiDecisionSchema.safeParse({
      action: 'hold',
      confidence: 0.4,
      reasoning: 'no signal',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full valid trade decision', () => {
    const result = AiDecisionSchema.safeParse(VALID_TRADE);
    expect(result.success).toBe(true);
  });

  it('rejects unknown action values', () => {
    const result = AiDecisionSchema.safeParse({ action: 'unknown', confidence: 0.5, reasoning: 'x' });
    expect(result.success).toBe(false);
  });
});
