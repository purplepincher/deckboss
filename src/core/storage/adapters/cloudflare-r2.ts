import { S3CompatibleAdapter, type S3CompatibleConfig } from "./s3-compatible";

export class CloudflareR2Adapter extends S3CompatibleAdapter {
  readonly id = "cloudflare-r2" as const;

  constructor(config: Omit<S3CompatibleConfig, "region">) {
    super({ ...config, region: "auto" });
  }
}
