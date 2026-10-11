import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushMessage, PushResult } from '../../domain/notification/models/push';
import { IPushSender } from '../../domain/notification/ports/notification-ports';

const ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;
const TIMEOUT_MS = 10_000;

interface ExpoTicket {
  status?: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class ExpoPushSender implements IPushSender {
  private readonly logger = new Logger(ExpoPushSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      results.push(...(await this.sendBatch(messages.slice(i, i + BATCH_SIZE))));
    }
    return results;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushResult[]> {
    const failed = batch.map((message) => ({ token: message.token, ok: false, invalidToken: false }));
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(batch.map((message) => this.toExpo(message))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push failed: HTTP ${res.status}`);
        return failed;
      }

      const body = (await res.json()) as { data?: ExpoTicket[] };
      if (!Array.isArray(body.data) || body.data.length !== batch.length) {
        this.logger.warn('Expo push returned an unexpected response');
        return failed;
      }
      return batch.map((message, index) => this.toResult(message.token, body.data![index]));
    } catch (error) {
      this.logger.warn(`Expo push error: ${error instanceof Error ? error.name : 'unknown'}`);
      return failed;
    }
  }

  private toResult(token: string, ticket: ExpoTicket): PushResult {
    if (ticket.status === 'ok') return { token, ok: true, invalidToken: false };
    const invalidToken = ticket.details?.error === 'DeviceNotRegistered';
    if (!invalidToken) {
      this.logger.warn(`Expo push rejected: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`);
    }
    return { token, ok: false, invalidToken };
  }

  private toExpo(message: PushMessage) {
    return {
      to: message.token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: 'default',
      priority: 'high',
      ...(message.channelId ? { channelId: message.channelId } : {}),
    };
  }

  private headers(): Record<string, string> {
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };
  }
}
