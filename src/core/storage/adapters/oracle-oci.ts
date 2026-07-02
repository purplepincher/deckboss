import { S3CompatibleAdapter, type S3CompatibleConfig } from "./s3-compatible";

export class OracleOciAdapter extends S3CompatibleAdapter {
  readonly id = "oracle-oci" as const;
  readonly displayName = "Oracle Object Storage";
  readonly icon = "🪨";

  constructor(config: S3CompatibleConfig) {
    super(config); // Oracle needs a real region (e.g. "us-ashburn-1"), unlike R2's "auto"
  }
}
