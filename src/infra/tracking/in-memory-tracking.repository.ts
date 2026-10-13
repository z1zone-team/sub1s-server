import { Injectable } from '@nestjs/common';
import { TrackingSession } from '../../domain/tracking/models/tracking-session';
import { ITrackingRepository } from '../../domain/tracking/ports/ITrackingRepository';

/**
 * 주행 세션을 프로세스 메모리에 둔다. 운영이 서버 한 대(단일 인스턴스)라는 전제다(2026-10-13 결정).
 * 서버를 다시 띄우면 진행 중인 세션이 사라지고, 인스턴스가 둘 이상이면 세션을 공유하지 못한다.
 * 그렇게 운영하려면 Valkey나 DB 구현으로 바꿔야 한다
 */
@Injectable()
export class InMemoryTrackingRepository implements ITrackingRepository {
  private readonly sessions = new Map<string, TrackingSession>();

  async save(session: TrackingSession): Promise<void> {
    this.sessions.set(session.sessionId, { ...session });
  }

  async findById(sessionId: string): Promise<TrackingSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }
}
