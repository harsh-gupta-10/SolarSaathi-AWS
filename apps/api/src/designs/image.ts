import { InvokeModelCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DesignCategory } from "./schema";

const prompts: Record<DesignCategory, string> = {
  DRYING: "Isometric architectural concept illustration of a generic flat rooftop with solar panels on one side, an open light-use clothes drying corner, clear walking route, warm Indian urban atmosphere. Simple visual idea, not a real property.",
  SEATING: "Isometric architectural concept illustration of a generic flat rooftop with solar panels on one side, a small removable seating nook, clear walking route, warm Indian urban atmosphere. Simple visual idea, not a real property.",
  GARDEN: "Isometric architectural concept illustration of a generic flat rooftop with solar panels on one side, a few light planter ideas in a separate corner, clear walking route, warm Indian urban atmosphere. Simple visual idea, not a real property.",
  STRETCH: "Isometric architectural concept illustration of a generic flat rooftop with solar panels on one side, an open empty stretch space, clear walking route, warm Indian urban atmosphere. Simple visual idea, not a real property.",
};
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 4_000_000;

export interface DesignImageGenerator { generate(category: DesignCategory): Promise<Buffer | undefined> }
export interface DesignAssetStore { put(key: string, image: Buffer): Promise<void>; delete(key: string): Promise<void>; signedUrl(key: string): Promise<string> }

export class NovaCanvasImageGenerator implements DesignImageGenerator {
  private readonly client: BedrockRuntimeClient;
  constructor(private readonly modelId: string, region: string) {
    this.client = new BedrockRuntimeClient({ region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 12_000 } });
  }
  async generate(category: DesignCategory): Promise<Buffer | undefined> {
    const body = JSON.stringify({ taskType: "TEXT_IMAGE",
      textToImageParams: { text: prompts[category], style: "DESIGN_SKETCH" },
      imageGenerationConfig: { numberOfImages: 1, width: 512, height: 512, quality: "standard" } });
    const output = await this.client.send(new InvokeModelCommand({ modelId: this.modelId,
      contentType: "application/json", accept: "application/json", body }),
    { abortSignal: AbortSignal.timeout(15_000) });
    if (!output.body || output.body.byteLength > 8_000_000) return undefined;
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder().decode(output.body)); } catch { return undefined; }
    const images = decoded && typeof decoded === "object" && "images" in decoded ? decoded.images : undefined;
    if (!Array.isArray(images) || images.length !== 1 || typeof images[0] !== "string" ||
      images[0].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(images[0])) return undefined;
    const bytes = Buffer.from(images[0], "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
    return bytes;
  }
}

export class S3DesignAssetStore implements DesignAssetStore {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, region: string) {
    this.client = new S3Client({ region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 4_000 } });
  }
  async put(key: string, image: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: image,
      ContentType: "image/png", ServerSideEncryption: "AES256" }), { abortSignal: AbortSignal.timeout(8_000) });
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(8_000) });
  }
  signedUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 300 });
  }
}
