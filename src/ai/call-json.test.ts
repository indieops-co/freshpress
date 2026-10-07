import { describe, it, expect } from 'vitest';
import { extractJsonSlice, extractJsonValue } from './call-json.js';

describe('extractJsonValue / extractJsonSlice', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonValue('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses a bare JSON array (campaigns-style responses)', () => {
    expect(extractJsonValue('[{"subject": "Hi"}, {"subject": "Again"}]')).toEqual([
      { subject: 'Hi' },
      { subject: 'Again' },
    ]);
  });

  it('prefers the fenced block over earlier prose braces', () => {
    const raw = 'Using {tokens} as placeholders, here is the result:\n```json\n{"a": 1}\n```';
    expect(extractJsonValue(raw)).toEqual({ a: 1 });
  });

  it('survives trailing prose containing braces (the greedy-regex failure mode)', () => {
    const raw = '{"a": 1}\n\nNote: the {brand} placeholder pattern is fine to keep.';
    expect(extractJsonValue(raw)).toEqual({ a: 1 });
  });

  it('handles prefaced responses without fences', () => {
    expect(extractJsonValue('Here is my answer: {"a": [1, 2, {"b": "c"}]}')).toEqual({
      a: [1, 2, { b: 'c' }],
    });
  });

  it('does not stop at braces or brackets inside strings', () => {
    expect(extractJsonValue('{"text": "curly } and square ] inside", "n": 1}')).toEqual({
      text: 'curly } and square ] inside',
      n: 1,
    });
    expect(extractJsonValue('{"quote": "she said \\"hi {there}\\""}')).toEqual({
      quote: 'she said "hi {there}"',
    });
  });

  it('falls back to whole-text scan when the fence has no JSON', () => {
    expect(extractJsonValue('```\njust prose\n```\n{"a": 1}')).toEqual({ a: 1 });
  });

  it('skips bracketed prose before the value (citations, markdown links)', () => {
    expect(extractJsonValue('I updated [the hero](url) as asked: {"a": 1}')).toEqual({ a: 1 });
    // "[1]" IS valid JSON — only the caller's declared expectation can rule it out.
    expect(extractJsonValue('See [1] for details: {"a": 1}', 'object')).toEqual({ a: 1 });
    expect(extractJsonValue('See [1] for details: {"a": 1}')).toEqual([1]);
  });

  it("declared expectation 'array' finds the array payload past prose objects", () => {
    expect(extractJsonValue('Config {"note": "x"} then data: [1, 2]', 'array')).toEqual([1, 2]);
  });

  it('prefers a later fence that parses over an earlier brace-y code fence', () => {
    const raw = '```css\n.hero { color: red; }\n```\n```json\n{"a": 1}\n```';
    expect(extractJsonValue(raw)).toEqual({ a: 1 });
  });

  it('still surfaces an unparseable span for callers that distinguish invalid from missing', () => {
    expect(extractJsonSlice('```json\n{oops: yes,}\n```')).toBe('{oops: yes,}');
    expect(extractJsonValue('```json\n{oops: yes,}\n```')).toBeNull();
  });

  it('returns null when no JSON value exists or parsing fails', () => {
    expect(extractJsonValue('no json here')).toBeNull();
    expect(extractJsonValue('{broken')).toBeNull();
    expect(extractJsonValue('')).toBeNull();
  });

  it('extractJsonSlice returns the raw substring for callers that parse themselves', () => {
    expect(extractJsonSlice('prefix {"a": 1} suffix }')).toBe('{"a": 1}');
    expect(extractJsonSlice('nothing')).toBeNull();
  });
});
