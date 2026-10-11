import { ConfigService } from '@nestjs/config';
import { SettlementScheduler } from './settlement.scheduler';
import { SettlementService } from './settlement.service';

describe('SettlementScheduler', () => {
  const originalEnv = process.env.NODE_ENV;
  let run: jest.Mock;

  const scheduler = (flag?: string) =>
    new SettlementScheduler(
      { runIfDue: run } as unknown as SettlementService,
      { get: () => flag } as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    run = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = originalEnv;
  });

  it('checks every minute outside of tests', async () => {
    process.env.NODE_ENV = 'production';
    const target = scheduler();

    target.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3 * 60_000);
    target.onApplicationShutdown();

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('stays off in tests and when switched off', async () => {
    process.env.NODE_ENV = 'test';
    scheduler().onApplicationBootstrap();
    process.env.NODE_ENV = 'production';
    scheduler('false').onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(run).not.toHaveBeenCalled();
  });

  it('does not start a check while the previous one is still running', async () => {
    let finish!: () => void;
    run.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const target = scheduler();

    const first = target.tick();
    await target.tick();
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await first;
    await target.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed check', async () => {
    run.mockRejectedValueOnce(new Error('db down'));
    const target = scheduler();

    await expect(target.tick()).resolves.toBeUndefined();
    await target.tick();

    expect(run).toHaveBeenCalledTimes(2);
  });
});
