import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StoredObject {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export function createStorage(): StoredObject {
  if (process.env.STORAGE_DRIVER === "s3") return new S3Storage();
  return new LocalStorage(process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads"));
}

class LocalStorage implements StoredObject {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root))) throw new Error("bad storage key");
    return target;
  }
}

class S3Storage implements StoredObject {
  private readonly client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "",
      secretAccessKey: process.env.S3_SECRET_KEY || "",
    },
  });
  private readonly bucket = process.env.S3_BUCKET || "lizon";

  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }));
  }

  async get(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error("empty object");
    return Buffer.from(bytes);
  }
}
