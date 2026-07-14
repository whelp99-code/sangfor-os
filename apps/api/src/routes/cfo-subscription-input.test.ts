import { describe, expect, it } from 'vitest';
import { BadRequestError, requireSubscriptionInput } from './cfo';

const valid = {
  name: 'Figma',
  amount: 20_000,
  cycle: 'monthly',
  nextBillingDate: '2026-08-01',
};

describe('requireSubscriptionInput', () => {
  it('accepts a fully specified subscription body', () => {
    expect(requireSubscriptionInput(valid)).toBe(valid);
  });

  it('rejects a missing or unparseable nextBillingDate instead of reaching Prisma', () => {
    expect(() => requireSubscriptionInput({ ...valid, nextBillingDate: undefined })).toThrow(
      BadRequestError,
    );
    expect(() => requireSubscriptionInput({ ...valid, nextBillingDate: 'not-a-date' })).toThrow(
      BadRequestError,
    );
  });

  it('rejects empty name, non-positive amount, and unknown cycle', () => {
    expect(() => requireSubscriptionInput({ ...valid, name: '  ' })).toThrow(BadRequestError);
    expect(() => requireSubscriptionInput({ ...valid, amount: 0 })).toThrow(BadRequestError);
    expect(() => requireSubscriptionInput({ ...valid, cycle: 'daily' })).toThrow(BadRequestError);
  });

  it('lets a partial PATCH body omit fields but still validates the ones present', () => {
    expect(() => requireSubscriptionInput({ amount: 5_000 }, { partial: true })).not.toThrow();
    expect(() => requireSubscriptionInput({ amount: -1 }, { partial: true })).toThrow(
      BadRequestError,
    );
    expect(() =>
      requireSubscriptionInput({ nextBillingDate: 'nope' }, { partial: true }),
    ).toThrow(BadRequestError);
  });
});
