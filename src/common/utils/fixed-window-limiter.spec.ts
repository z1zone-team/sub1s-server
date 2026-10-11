import { FixedWindowLimiter } from './fixed-window-limiter';

describe('FixedWindowLimiter', () => {
  const MINUTE = 60_000;

  it('allows up to the limit and then blocks until the window ends', () => {
    const limiter = new FixedWindowLimiter(3, MINUTE);

    expect([0, 1, 2].map(() => limiter.tryConsume('a', 1000).allowed)).toEqual([true, true, true]);
    expect(limiter.tryConsume('a', 1000).allowed).toBe(false);
    expect(limiter.tryConsume('a', 1000 + MINUTE - 1).allowed).toBe(false);
    expect(limiter.tryConsume('a', 1000 + MINUTE).allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE);

    expect(limiter.tryConsume('a', 0).allowed).toBe(true);
    expect(limiter.tryConsume('b', 0).allowed).toBe(true);
    expect(limiter.tryConsume('a', 0).allowed).toBe(false);
  });

  it('tells how many seconds are left in the window, at least one', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE);
    limiter.tryConsume('a', 0);

    expect(limiter.tryConsume('a', 15_000)).toEqual({ allowed: false, retryAfterSec: 45 });
    expect(limiter.tryConsume('a', MINUTE - 100).retryAfterSec).toBe(1);
  });

  it('does not count a blocked request, so the window still ends on time', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE);
    limiter.tryConsume('a', 0);
    for (let i = 0; i < 50; i += 1) limiter.tryConsume('a', 1000);

    expect(limiter.tryConsume('a', MINUTE).allowed).toBe(true);
  });

  it('keeps the number of tracked keys bounded', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE, 100);
    for (let i = 0; i < 1000; i += 1) limiter.tryConsume(`ip-${i}`, i);

    expect(limiter['windows'].size).toBeLessThanOrEqual(100);
    expect(limiter.tryConsume('ip-999', 1000).allowed).toBe(false);
  });
});
