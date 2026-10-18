import { TrackingSession } from '../../domain/tracking/models/tracking-session';
import {
  InMemoryTrackingRepository,
  MAX_SESSIONS,
  SESSION_TTL_MS,
} from './in-memory-tracking.repository';

describe('InMemoryTrackingRepository', () => {
  const now = new Date('2026-10-18T03:00:00Z');
  const session = (sessionId: string, updatedAt = now): TrackingSession =>
    ({
      sessionId,
      userId: 'user-1',
      updatedAt,
      createdAt: updatedAt,
    }) as TrackingSession;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('forgets a session that was not updated for longer than the time to live', async () => {
    const repo = new InMemoryTrackingRepository();
    await repo.save(session('old'));

    jest.setSystemTime(now.getTime() + SESSION_TTL_MS - 1000);
    expect(await repo.findById('old')).not.toBeNull();

    jest.setSystemTime(now.getTime() + SESSION_TTL_MS + 1000);
    expect(await repo.findById('old')).toBeNull();
  });

  it('drops expired sessions when another one is saved', async () => {
    const repo = new InMemoryTrackingRepository();
    await repo.save(session('old'));
    jest.setSystemTime(now.getTime() + SESSION_TTL_MS + 1000);

    await repo.save(session('new', new Date()));

    expect(await repo.findById('old')).toBeNull();
    expect(await repo.findById('new')).not.toBeNull();
  });

  it('keeps at most the limit and drops the session that was updated longest ago', async () => {
    const repo = new InMemoryTrackingRepository();
    for (let i = 0; i < MAX_SESSIONS; i += 1) await repo.save(session(`s${i}`));
    await repo.save(session('s0'));

    await repo.save(session('extra'));

    expect(await repo.findById('s0')).not.toBeNull();
    expect(await repo.findById('s1')).toBeNull();
    expect(await repo.findById('extra')).not.toBeNull();
  });

  it('deletes a session', async () => {
    const repo = new InMemoryTrackingRepository();
    await repo.save(session('a'));

    expect(await repo.delete('a')).toBe(true);
    expect(await repo.findById('a')).toBeNull();
  });
});
