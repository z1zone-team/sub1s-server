import { TrackingSession } from '../models/tracking-session';

export interface ITrackingRepository {
  save(session: TrackingSession): Promise<void>;
  findById(sessionId: string): Promise<TrackingSession | null>;
  delete(sessionId: string): Promise<boolean>;
}

export const TRACKING_REPOSITORY = Symbol('TRACKING_REPOSITORY');
