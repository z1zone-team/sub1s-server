import { Injectable } from '@nestjs/common';
import { TrackingSession } from '../../domain/tracking/models/tracking-session';
import { ITrackingRepository } from '../../domain/tracking/ports/ITrackingRepository';

/** 마지막 갱신 뒤 이 시간이 지나면 세션을 없는 것으로 본다 */
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
/** 동시에 들고 있는 세션 수 상한 */
export const MAX_SESSIONS = 5000;

const isExpired = (session: TrackingSession): boolean =>
  Date.now() - session.updatedAt.getTime() > SESSION_TTL_MS;

/**
 * 주행 세션을 프로세스 메모리에 둔다. 운영이 서버 한 대(단일 인스턴스)라는 전제다(2026-10-13 결정).
 * 서버를 다시 띄우면 진행 중인 세션이 사라지고, 인스턴스가 둘 이상이면 세션을 공유하지 못한다.
 * 그렇게 운영하려면 Valkey나 DB 구현으로 바꿔야 한다
 */
@Injectable()
export class InMemoryTrackingRepository implements ITrackingRepository {
  private readonly sessions = new Map<string, TrackingSession>();

  async save(session: TrackingSession): Promise<void> {
    this.removeExpired();
    // 다시 저장하면 가장 최근으로 옮겨 상한을 넘을 때 오래 갱신되지 않은 세션부터 지운다
    this.sessions.delete(session.sessionId);
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    this.sessions.set(session.sessionId, { ...session });
  }

  async findById(sessionId: string): Promise<TrackingSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (isExpired(session)) {
      this.sessions.delete(sessionId);
      return null;
    }
    return { ...session };
  }

  private removeExpired(): void {
    for (const [id, session] of this.sessions) {
      if (isExpired(session)) this.sessions.delete(id);
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }
}
