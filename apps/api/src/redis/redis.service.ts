import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) return;
    const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    client.on("error", () => {
      this.client = null;
    });
    void client.connect().then(() => {
      this.client = client;
    }).catch(() => {
      this.client = null;
    });
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    if (this.client) {
      try {
        const count = await this.client.incr(key);
        if (count === 1) await this.client.expire(key, windowSec);
        return count <= limit;
      } catch {
        // Redis недоступен — считаем в памяти процесса.
      }
    }
    return memoryHit(key, limit, windowSec);
  }
}

const memory = new Map<string, { count: number; reset: number }>();

function memoryHit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.reset < now) {
    memory.set(key, { count: 1, reset: now + windowSec * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
