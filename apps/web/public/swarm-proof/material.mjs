// Build geometry and field colors from fitted points. No reference image is loaded.
export function createMaterialChart(data) {
  const sourceWidth = 1536,
    sourceHeight = 1024;
  const width = 128,
    height = 512,
    pathWidth = 512;
  const flowWidth = 512,
    flowHeight = 64,
    bins = 256,
    densityFloor = 0.7;
  const count = data.length / 12;
  const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const columns = Array.from({ length: width }, () => []);
  for (let i = 0; i < count; i++) {
    const column = (data[i * 12] / sourceWidth) * (width - 1);
    for (let c = Math.max(0, Math.floor(column) - 2); c <= Math.min(width - 1, Math.ceil(column) + 2); c++)
      columns[c].push(i);
  }
  const geometry = new Float32Array(width * height);
  const geometricColor = new Float32Array(width * height * 3);
  columns.forEach((ids, x) => {
    ids.sort((a, b) => data[a * 12 + 1] - data[b * 12 + 1]);
    const sourceX = (x / (width - 1)) * sourceWidth;
    for (let row = 0; row < height; row++) {
      const q = row / (height - 1),
        index = q * (ids.length - 1);
      const base = Math.floor(index),
        fraction = index - base;
      const at = row * width + x;
      const rawY = ids.length
        ? mix(data[ids[base] * 12 + 1], data[ids[Math.min(ids.length - 1, base + 1)] * 12 + 1], fraction)
        : 352 + q * 610;
      const blend = clamp(sourceX / 1100),
        organization = blend * blend * (3 - 2 * blend);
      geometry[at] = mix(352 + q * 610, rawY, organization);
      let totalWeight = 0;
      for (let k = Math.max(0, base - 4); k <= Math.min(ids.length - 1, base + 4); k++) {
        const id = ids[k] * 12;
        const dx = data[id] - sourceX,
          dy = data[id + 1] - rawY;
        const weight = 1 / (16 + dx * dx + dy * dy);
        totalWeight += weight;
        for (let channel = 0; channel < 3; channel++)
          geometricColor[at * 3 + channel] += data[id + 3 + channel] * weight;
      }
      for (let channel = 0; channel < 3; channel++)
        geometricColor[at * 3 + channel] = totalWeight
          ? geometricColor[at * 3 + channel] / totalWeight
          : [0.55, 0.83, 0.87][channel];
    }
  });
  function sampleGrid(grid, gridWidth, x, q, stride = 1, channel = 0) {
    const xx = clamp(x) * (gridWidth - 1),
      yy = clamp(q) * (height - 1);
    const x0 = Math.floor(xx),
      x1 = Math.min(gridWidth - 1, x0 + 1);
    const y0 = Math.floor(yy),
      y1 = Math.min(height - 1, y0 + 1);
    const value = (x, y) => grid[(y * gridWidth + x) * stride + channel];
    return mix(
      mix(value(x0, y0), value(x1, y0), xx - x0),
      mix(value(x0, y1), value(x1, y1), xx - x0),
      yy - y0,
    );
  }
  const arc = new Float32Array(width * height);
  const paths = new Float32Array(pathWidth * height * 2);
  const pixels = new Uint8Array(pathWidth * height * 4);
  const colorPixels = new Uint8Array(pathWidth * height * 4);
  const lengths = [],
    dx = sourceWidth / (width - 1);
  const encode16 = (pixels, offset, x) => {
    const value = Math.round(clamp(x) * 65535);
    pixels[offset] = value >> 8;
    pixels[offset + 1] = value & 255;
  };
  for (let row = 0; row < height; row++) {
    let length = 0;
    for (let x = 1; x < width; x++) {
      length += Math.hypot(dx, geometry[row * width + x] - geometry[row * width + x - 1]);
      arc[row * width + x] = length;
    }
    lengths.push(length);
    for (let x = 1; x < width; x++) arc[row * width + x] /= length;
    let cell = 0;
    for (let x = 0; x < pathWidth; x++) {
      const s = x / (pathWidth - 1);
      while (cell < width - 2 && arc[row * width + cell + 1] < s) cell++;
      const fraction =
        (s - arc[row * width + cell]) / (arc[row * width + cell + 1] - arc[row * width + cell]);
      const xx = (cell + fraction) * dx;
      const yy = mix(geometry[row * width + cell], geometry[row * width + cell + 1], fraction);
      const at = row * pathWidth + x;
      encode16(pixels, at * 4, xx / sourceWidth);
      encode16(pixels, at * 4 + 2, yy / sourceHeight);
      paths[at * 2] = ((pixels[at * 4] * 256 + pixels[at * 4 + 1]) / 65535) * sourceWidth;
      paths[at * 2 + 1] = ((pixels[at * 4 + 2] * 256 + pixels[at * 4 + 3]) / 65535) * sourceHeight;
      for (let channel = 0; channel < 3; channel++)
        colorPixels[at * 4 + channel] = Math.round(
          clamp(sampleGrid(geometricColor, width, xx / sourceWidth, row / (height - 1), 3, channel)) * 255,
        );
      colorPixels[at * 4 + 3] = 255;
    }
  }
  const sourceMaterial = new Float32Array(count * 4);
  const groups = Array.from({ length: flowHeight }, () => []);
  for (let i = 0; i < count; i++) {
    const x = data[i * 12],
      y = data[i * 12 + 1];
    let low = 0,
      high = 1;
    for (let step = 0; step < 16; step++) {
      const mid = (low + high) * 0.5;
      if (sampleGrid(geometry, width, x / sourceWidth, mid) < y) low = mid;
      else high = mid;
    }
    const q = (low + high) * 0.5,
      s = sampleGrid(arc, width, x / sourceWidth, q);
    sourceMaterial.set(
      [
        q,
        s,
        clamp(x - sampleGrid(paths, pathWidth, s, q, 2, 0), -1.5, 1.5),
        clamp(y - sampleGrid(paths, pathWidth, s, q, 2, 1), -1.5, 1.5),
      ],
      i * 4,
    );
    groups[Math.min(flowHeight - 1, Math.floor(q * flowHeight))].push(i);
  }
  const material = sourceMaterial.slice(),
    flowPixels = new Uint8Array(flowWidth * flowHeight * 4);
  const inverseMaps = [],
    densityGainRange = 4;
  for (let band = 0; band < flowHeight; band++) {
    const ids = groups[band];
    ids.sort((a, b) => sourceMaterial[a * 4 + 1] - sourceMaterial[b * 4 + 1]);
    const density = new Float64Array(bins),
      smooth = new Float64Array(bins);
    ids.forEach((id, rank) => {
      density[Math.min(bins - 1, Math.floor(clamp(sourceMaterial[id * 4 + 1]) * bins))]++;
      material[id * 4 + 1] = (rank + 0.5) / ids.length;
    });
    for (let i = 0; i < bins; i++) {
      let weightSum = 0;
      for (let offset = -6; offset <= 6; offset++) {
        const weight = Math.exp((-offset * offset) / 8);
        smooth[i] += density[clamp(i + offset, 0, bins - 1)] * weight;
        weightSum += weight;
      }
      smooth[i] /= weightSum;
    }
    const total = smooth.reduce((a, b) => a + b),
      cdf = new Float64Array(bins + 1);
    for (let i = 0; i < bins; i++) {
      smooth[i] = total ? smooth[i] / total : 1 / bins;
      cdf[i + 1] = cdf[i] + (1 - densityFloor) * smooth[i] + densityFloor / bins;
    }
    const inverse = (u) => {
      let low = 0,
        high = bins - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (cdf[mid + 1] < u) low = mid + 1;
        else high = mid;
      }
      const mass = cdf[low + 1] - cdf[low];
      return {
        s: (low + clamp((u - cdf[low]) / mass)) / bins,
        gain: smooth[low] / mass,
        dsdu: 1 / bins / mass,
      };
    };
    inverseMaps.push(inverse);
    for (let x = 0; x < flowWidth; x++) {
      const sample = inverse(x / (flowWidth - 1)),
        at = (band * flowWidth + x) * 4;
      encode16(flowPixels, at, sample.s);
      flowPixels[at + 2] = Math.round(clamp(sample.gain / densityGainRange) * 255);
      flowPixels[at + 3] = 255;
    }
  }
  const summarize = (values) => {
    values.sort((a, b) => a - b);
    return {
      min: values[0],
      median: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      max: values.at(-1),
    };
  };
  const inletPerUnitRate = [],
    bodyPerUnitRate = [];
  for (let band = 0; band < flowHeight; band++)
    for (let col = 1; col < flowWidth - 1; col++) {
      const q = (band + 0.5) / flowHeight,
        u = col / (flowWidth - 1),
        du = 1e-4;
      const s0 = inverseMaps[band](u - du).s,
        s1 = inverseMaps[band](u + du).s;
      const x = sampleGrid(paths, pathWidth, inverseMaps[band](u).s, q, 2, 0);
      const vx =
        (sampleGrid(paths, pathWidth, s1, q, 2, 0) - sampleGrid(paths, pathWidth, s0, q, 2, 0)) / (du * 2);
      const vy =
        (sampleGrid(paths, pathWidth, s1, q, 2, 1) - sampleGrid(paths, pathWidth, s0, q, 2, 1)) / (du * 2);
      if (x >= 30 && x <= 350) inletPerUnitRate.push(vx);
      if (x >= 650 && x <= 1495) bodyPerUnitRate.push(Math.hypot(vx, vy));
    }
  const targetInletSpeed = 191 * 1.5;
  const rate = targetInletSpeed / summarize(inletPerUnitRate).median;
  const stats = {
    sourceWidth,
    sourceHeight,
    particleCount: count,
    densityFloor,
    densityGainRange,
    phaseRate: rate,
    fullTransitSeconds: 1 / rate,
    targetInletSpeed,
    pathLength: summarize(lengths),
    inletHorizontalSpeed: summarize(inletPerUnitRate.map((v) => v * rate)),
    bodyArcSpeed: summarize(bodyPerUnitRate.map((v) => v * rate)),
    particlesPerBand: summarize(groups.map((group) => group.length)),
  };
  return {
    width: pathWidth,
    height,
    pixels,
    material,
    flowWidth,
    flowHeight,
    flowPixels,
    colorPixels,
    rate,
    stats,
  };
}
