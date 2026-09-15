import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { test, expect } from '../fixtures/browser';

const run = promisify(execFile);
const output = path.resolve('output/swarm-motion-videos');
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      nb_read_frames: z.string().optional(),
    }),
  ),
  packets: z.array(
    z.object({
      pts_time: z.string().optional(),
      duration_time: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string().optional(), size: z.string() }),
});

// Artifact acceptance requires local ffprobe and intentionally runs outside ordinary CI.
test.skip(
  process.env.SWARM_EXPORT_ACCEPTANCE !== '1',
  'Set SWARM_EXPORT_ACCEPTANCE=1 to render local video artifacts.',
);

for (const exportCase of [
  { id: 'convergence', name: 'Convergence', width: 1920, height: 1080 },
  { id: 'tide', name: 'Tidal field', width: 1920, height: 1080 },
  { id: 'parallax', name: 'Deep orbit', width: 1920, height: 1080 },
  { id: 'filaments', name: 'Filament flow', width: 1920, height: 1080 },
  { id: 'breathe', name: 'Living volume', width: 1920, height: 1080 },
  { id: 'convergence', name: 'Convergence', width: 3840, height: 2160 },
]) {
  const resolution = exportCase.height === 2160 ? '4K' : '1080p';
  test(`${exportCase.name} exports a silent ${resolution} loop`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/concepts/swarm/motion?version=${exportCase.id}`);
    await expect(page.getByRole('tab', { name: new RegExp(exportCase.name) })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const exportButton = page.getByRole('button', { name: `Export ${resolution} video`, exact: true });
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    const link = page.getByRole('link', { name: new RegExp(`Download ${exportCase.name} · ${resolution}`) });
    await expect(link).toBeVisible({ timeout: 45_000 });
    const pending = page.waitForEvent('download');
    await link.click();
    const download = await pending;
    await mkdir(output, { recursive: true });
    const destination = path.join(output, download.suggestedFilename());
    await download.saveAs(destination);
    expect(await download.failure()).toBeNull();

    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-show_packets',
        '-show_entries',
        'format=duration,size:stream=codec_type,codec_name,width,height,nb_read_frames:packet=pts_time,duration_time',
        '-of',
        'json',
        destination,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const probe = probeSchema.parse(JSON.parse(stdout));
    expect(probe.streams).toHaveLength(1);
    const video = probe.streams[0];
    expect(video.codec_type).toBe('video');
    expect(video.width).toBe(exportCase.width);
    expect(video.height).toBe(exportCase.height);
    const packetEnds = probe.packets.flatMap((packet) => {
      const timestamp = Number(packet.pts_time);
      const length = Number(packet.duration_time);
      return Number.isFinite(timestamp) ? [timestamp + (Number.isFinite(length) ? length : 0)] : [];
    });
    expect(packetEnds.length).toBeGreaterThan(0);
    // MediaRecorder WebM commonly omits a finite container duration; packet
    // timestamps still establish how much of the loop was actually encoded.
    const reportedDuration = Number(probe.format.duration);
    const duration =
      Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : Math.max(...packetEnds);
    const frames = Number(video.nb_read_frames);
    expect(duration).toBeGreaterThan(14.5);
    expect(duration).toBeLessThan(15.5);
    expect(frames).toBeGreaterThan(30);
    const report = {
      filename: path.basename(destination),
      width: video.width,
      height: video.height,
      durationSeconds: duration,
      decodedFrames: frames,
      averageFramesPerSecond: frames / duration,
      bytes: Number(probe.format.size),
      codec: video.codec_name,
      audioStreams: 0,
    };
    await writeFile(destination + '.json', JSON.stringify(report, null, 2) + '\n');
    await test
      .info()
      .attach('Export metrics', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify(report));
    expect(errors).toEqual([]);
  });
}
