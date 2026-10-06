import { Injectable } from '@nestjs/common';
import { TrackingSession } from '../../../domain/tracking/models/tracking-session';
import { ITrackingRepository } from '../../../domain/tracking/ports/ITrackingRepository';

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
