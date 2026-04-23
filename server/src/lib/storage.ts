import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';


export const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

export async function uploadToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; url: string }> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );

  return {
    key: params.key,
    url: `s3://${config.S3_BUCKET}/${params.key}`,
  };
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function testS3Connection(): Promise<{ ok: boolean; bucket: string; error?: string }> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return { ok: true, bucket: config.S3_BUCKET };
  } catch (err) {
    return {
      ok: false,
      bucket: config.S3_BUCKET,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadFromS3(key: string): Promise<Buffer> {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
      })
    );
  
    if (!response.Body) {
      throw new Error(`No body returned for S3 object ${key}`);
    }
  
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }