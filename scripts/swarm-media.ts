import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { swarmStudies, swarmMediaBase } from '../apps/web/components/landing/swarm-media';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'output/swarm-myriad-deploy' },
    'env-file': { type: 'string', default: '.env.swarm-media' },
    'base-url': { type: 'string' },
    upload: { type: 'boolean', default: false },
    stage: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
  },
});
const bucket = 'macrofold-marketing-media';
const prefix = 'swarm/myriad/v1';
const cache = 'public, max-age=31536000, immutable';
const source = path.resolve(values.source);
const assets: { file: string; key: string; bytes: number; sha256: string; type: string }[] = [];
for (const id of swarmStudies) {
  for (const width of [960, 1440]) {
    for (const file of [`web/${id}/${id}-${width}.h264.mp4`, `stills/${id}-${width}.webp`]) {
      const bytes = await readFile(path.join(source, file));
      assets.push({
        file,
        key: `${prefix}/${file}`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        type: file.endsWith('.mp4') ? 'video/mp4' : 'image/webp',
      });
    }
  }
}
await mkdir('output/swarm-site', { recursive: true });
await writeFile('output/swarm-site/asset-manifest.json', JSON.stringify({ bucket, prefix, assets }, null, 2));
console.log(
  `${assets.length} verified local assets, ${(assets.reduce((sum, a) => sum + a.bytes, 0) / 1e6).toFixed(2)} MB`,
);

if (values.stage) {
  for (const asset of assets) {
    const destination = path.join('apps/web/public/swarm-media/myriad/v1', asset.file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, asset.file), destination);
  }
  console.log('Local media ready. Set MARKETING_MEDIA_BASE_URL=/swarm-media/myriad/v1');
}

if (values.upload) {
  const fileEnv = await readFile(values['env-file'], 'utf8')
    .then(parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return {};
      throw error;
    });
  const env = { ...fileEnv, ...process.env };
  const endpoint = env.SWARM_R2_ENDPOINT;
  const accessKeyId = env.SWARM_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.SWARM_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error(
      'Set SWARM_R2_ENDPOINT, SWARM_R2_ACCESS_KEY_ID and SWARM_R2_SECRET_ACCESS_KEY in the ignored .env.swarm-media file.',
    );
  if (!/^https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com\/?$/.test(endpoint))
    throw new Error('Expected an HTTPS Cloudflare R2 S3 endpoint.');
  const s3 = new S3Client({
    endpoint,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2,
  });
  try {
    for (const asset of assets) {
      const input = { Bucket: bucket, Key: asset.key };
      const previous = await s3.send(new HeadObjectCommand(input)).catch((error: unknown) => {
        if (error instanceof Error && 'name' in error && error.name === 'NotFound') return undefined;
        throw error;
      });
      if (previous) {
        if (
          previous.Metadata?.sha256 !== asset.sha256 ||
          previous.ContentLength !== asset.bytes ||
          previous.ContentType !== asset.type ||
          previous.CacheControl !== cache
        )
          throw new Error(`Refusing to overwrite a different versioned object: ${asset.key}`);
        console.log(`Already uploaded: ${asset.file}`);
        continue;
      }
      await s3.send(
        new PutObjectCommand({
          ...input,
          Body: createReadStream(path.join(source, asset.file)),
          ContentLength: asset.bytes,
          ContentType: asset.type,
          CacheControl: cache,
          Metadata: { sha256: asset.sha256 },
          IfNoneMatch: '*',
        }),
      );
      const check = await s3.send(new HeadObjectCommand(input));
      if (check.ContentLength !== asset.bytes || check.Metadata?.sha256 !== asset.sha256)
        throw new Error(`Upload verification failed: ${asset.key}`);
      console.log(`Uploaded: ${asset.file}`);
    }
    await writeFile(
      'output/swarm-site/upload.json',
      JSON.stringify({ bucket, prefix, verifiedAt: new Date().toISOString(), assets }, null, 2),
    );
  } finally {
    s3.destroy();
  }
}

if (values.verify) {
  const base = swarmMediaBase(values['base-url']);
  if (!base?.startsWith('https://'))
    throw new Error('--verify requires --base-url https://your-media-domain/swarm/myriad/v1');
  const results = [];
  for (const asset of assets) {
    const url = `${base}/${asset.file}`;
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0] !== asset.type ||
      Number(response.headers.get('content-length')) !== asset.bytes ||
      !response.headers.get('cache-control')?.includes('immutable')
    )
      throw new Error(`Public metadata/cache verification failed: ${asset.file} (${response.status})`);
    if (asset.type === 'video/mp4') {
      const range = await fetch(url, {
        headers: { Range: 'bytes=0-31' },
        signal: AbortSignal.timeout(15000),
      });
      if (range.status !== 206 || range.headers.get('content-range') !== `bytes 0-31/${asset.bytes}`) {
        await range.body?.cancel();
        throw new Error(`Public byte-range verification failed: ${asset.file}`);
      }
      if ((await range.arrayBuffer()).byteLength !== 32)
        throw new Error(`Incorrect range body: ${asset.file}`);
    }
    results.push({
      file: asset.file,
      status: response.status,
      cache: response.headers.get('cf-cache-status'),
    });
  }
  await writeFile(
    'output/swarm-site/public-verification.json',
    JSON.stringify({ base, verifiedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log('All 44 public assets passed headers, size, cache-policy and MP4 range checks.');
}
if (!values.upload && !values.stage && !values.verify) {
  const total = (await stat('output/swarm-site/asset-manifest.json')).size;
  console.log(`Dry run only; wrote ${total}-byte asset manifest. Use --stage, --upload or --verify.`);
}
