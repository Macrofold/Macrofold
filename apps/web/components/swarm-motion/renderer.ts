export const LOOP_SECONDS = 15;

export type SwarmVariant = 'convergence' | 'tide' | 'parallax' | 'filaments' | 'breathe';

const variantNumbers: Record<SwarmVariant, number> = {
  convergence: 0,
  tide: 1,
  parallax: 2,
  filaments: 3,
  breathe: 4,
};

const vertexSource = `
precision highp float;
attribute vec3 a_target;
attribute vec3 a_normal;
attribute vec2 a_identity;
uniform vec2 u_cover;
uniform float u_pixels;
uniform float u_seconds;
uniform float u_variant;
varying vec3 v_color;
varying float v_alpha;

vec3 curve(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float r = 1.0 - t;
  return r*r*r*a + 3.0*r*r*t*b + 3.0*r*t*t*c + t*t*t*d;
}

mat2 turn(float angle) {
  return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
}

void main() {
  float time = u_seconds;
  float seed = a_identity.x;
  float stream = a_identity.y;
  float along = clamp((a_target.x + 1.75) / 6.75, 0.0, 1.0);
  float phase = time * 0.62;
  float formed = smoothstep(3.5, 5.0, time);
  vec3 target = a_target;
  vec3 normal = a_normal;
  float twist = 0.0;
  float yaw = 0.015;
  float pitch = -0.045;

  // These are deformations of a sampled three-dimensional implicit surface.
  // No image, UV displacement, or texture supplies its structure or motion.
  if (u_variant < 0.5) {
    twist = 0.13 * sin(phase + target.x * 0.72) * formed;
    target.y += 0.08 * sin(target.z * 1.8 + phase) * formed;
    yaw += 0.035 * sin(phase);
  } else if (u_variant < 1.5) {
    twist = 0.21 * sin(target.x * 0.9 - phase) * formed;
    target.y += 0.18 * sin(target.x * 1.45 - time * 0.85) * formed;
    target.z += 0.15 * cos(target.y * 1.3 + target.x - phase) * formed;
    yaw = -0.04 + 0.06 * sin(phase * 0.7);
  } else if (u_variant < 2.5) {
    twist = 0.09 * sin(target.x + phase) * formed;
    yaw = -0.12 + 0.25 * smoothstep(0.0, 10.0, time);
    pitch = -0.09 + 0.09 * sin(time * 0.28);
  } else if (u_variant < 3.5) {
    twist = 0.29 * sin(target.x * 1.15 - phase) * formed;
    target += normal * sin(target.x * 2.2 + target.y - time * 0.95) * 0.10 * formed;
    target.x += 0.12 * sin(target.z * 1.8 + phase) * formed;
    yaw = 0.05 * cos(time * 0.33);
  } else {
    float breath = 1.0 + 0.12 * sin(time * 0.91 - target.x * 0.58) * formed;
    target.yz *= breath;
    target.x += 0.10 * sin(target.y * 1.6 + phase) * formed;
    twist = 0.10 * sin(target.x * 0.8 + phase) * formed;
    yaw = -0.025 + 0.04 * sin(time * 0.36);
  }
  target.yz = turn(twist) * target.yz;
  normal.yz = turn(twist) * normal.yz;

  float opacity;
  vec3 p;
  if (stream > 0.5) {
    float initialColumn = pow(clamp((a_target.x + 4.85) / 3.65, 0.0, 1.0), 1.0 / 0.72);
    float row = (a_target.y + 0.68 * (1.0 - initialColumn)) / (2.7 - 1.4 * initialColumn);
    float lane = fract(initialColumn + time * 0.085);
    float birth = lane * 3.3 + seed * 0.28;
    opacity = smoothstep(birth, birth + 0.6, time);
    opacity *= 0.48 + 0.34 * lane;
    // Parent nodes really travel along their lanes. Their masked return lies
    // outside the visible inflow, so a wrapped column never jumps on screen.
    opacity *= smoothstep(0.0, 0.055, lane) * (1.0 - smoothstep(0.94, 1.0, lane));
    p = vec3(-4.85 + 3.65 * pow(lane, 0.72), row * (2.7 - 1.4 * lane) - 0.68 * (1.0 - lane), a_target.z);
    p.y += sin(time * 0.65 - lane * 5.0 + a_target.y * 0.6) * 0.035 * lane;
    p.z += cos(time * 0.6 + lane * 4.0) * 0.04 * lane;
  } else {
    float birth = 0.25 + along * 2.45 + seed * 0.8;
    float travel = clamp((time - birth) / (0.95 + along * 0.55), 0.0, 1.0);
    float eased = travel * travel * (3.0 - 2.0 * travel);
    // Many children share an ordered parent lane. They become individually
    // visible only after separating, avoiding bright overlapping launch blobs.
    float row = floor(fract(seed * 31.73) * 23.0) / 22.0;
    float column = floor(fract(seed * 13.19) * 5.0) / 4.0;
    vec3 origin = vec3(-4.65 + column * 0.58, (row - 0.5) * 2.45 - 0.62, (column - 0.5) * 0.38);
    vec3 bendA = vec3(-2.65, origin.y * 0.8, origin.z);
    vec3 bendB = vec3(target.x - 0.75, target.y * 0.76, target.z * 0.72);
    if (u_variant > 0.5 && u_variant < 1.5) {
      bendA.y += sin(seed * 6.283 + time * 0.35) * 0.20;
      bendB.z += 0.30 * sin(target.y);
    } else if (u_variant > 1.5 && u_variant < 2.5) {
      bendA.z -= 0.45;
      bendB.z += 0.25;
    } else if (u_variant > 2.5 && u_variant < 3.5) {
      bendA.yz = turn((row - 0.5) * 0.8) * bendA.yz;
      bendB.yz = turn(0.30 * sin(target.x)) * bendB.yz;
    } else if (u_variant > 3.5) {
      bendA.y *= 0.65;
      bendB.yz *= 0.72;
    }
    p = curve(origin, bendA, bendB, target, eased);
    opacity = smoothstep(0.04, 0.40, travel) * (0.08 + 0.92 * eased * eased);
  }

  // A modest perspective camera eases back as the form acquires its scale.
  p.xz = turn(yaw) * p.xz;
  normal.xz = turn(yaw) * normal.xz;
  p.yz = turn(pitch) * p.yz;
  normal.yz = turn(pitch) * normal.yz;
  float reveal = smoothstep(0.0, 5.0, time);
  float zoom = mix(1.115, 1.0, reveal);
  float perspective = 14.0 / (14.0 - p.z);
  vec2 clip = vec2(p.x / 5.0, p.y / 3.333333) * perspective * zoom * u_cover;
  gl_Position = vec4(clip, 0.0, 1.0);

  float facing = abs(dot(normalize(normal), normalize(vec3(-0.25, 0.45, 0.85))));
  float nearSide = smoothstep(-1.8, 1.8, p.z);
  float ridge = pow(1.0 - abs(normalize(normal).z), 2.0);
  float ivory = smoothstep(0.03, 0.78, sin(a_target.x * 1.65 + a_target.y * 1.1 - a_target.z * 1.6));
  vec3 cyan = vec3(0.48, 0.82, 0.94);
  vec3 warm = vec3(0.96, 0.88, 0.71);
  vec3 tint = mix(cyan, warm, ivory * 0.78);
  float light = (0.42 + 0.53 * facing + 0.18 * ridge) * mix(0.50, 1.0, nearSide) * 2.5;
  if (stream > 0.5) {
    tint = mix(cyan, warm, step(0.88, seed));
    light = 1.65;
  }
  float fade = 1.0 - smoothstep(10.0, 13.0, time);
  float appear = smoothstep(0.0, 0.4, time);
  v_color = tint * light;
  v_alpha = opacity * fade * appear;
  float diameter = mix(1.80, 2.05, stream) * u_pixels * perspective;
  gl_PointSize = max(1.0, diameter);
  v_alpha *= min(1.0, diameter * diameter);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_color;
varying float v_alpha;
void main() {
  float radius = length(gl_PointCoord - 0.5) * 2.0;
  float coverage = 1.0 - smoothstep(0.12, 1.0, radius);
  gl_FragColor = vec4(v_color * v_alpha * coverage, 1.0);
}
`;

/** Sample both analytic depth roots of a gyroid on an ordered XY lattice. */
function createPointVolume() {
  const points: number[] = [];
  const frequency = 3.0;
  const step = 0.02;
  const hash = (value: number) => {
    const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return raw - Math.floor(raw);
  };
  for (let x = -1.75; x <= 5.0; x += step) {
    const along = (x + 1.75) / 6.75;
    const radius = 0.48 + 2.62 * Math.pow(along, 0.8);
    const gx = x * frequency + 0.52 * Math.sin(x * 0.85) + 0.38;
    const gxDerivative = frequency + 0.442 * Math.cos(x * 0.85);
    const yFrequency = frequency * (0.82 + 0.24 * Math.sin(x * 0.77 + 0.3) + 0.12 * along);
    const zFrequency = frequency * (0.87 + 0.15 * Math.cos(x * 0.67 - 0.2));
    const sinX = Math.sin(gx);
    const cosX = Math.cos(gx);
    for (let y = -3.5; y <= 3.5; y += step) {
      const maximumRadius = radius * 1.13;
      if (Math.abs(y) > maximumRadius) continue;
      const maximumDepth = 0.73 * Math.sqrt(maximumRadius * maximumRadius - y * y);
      const gy = y * yFrequency + 0.82;
      const a = Math.sin(gy);
      const b = cosX;
      const length = Math.hypot(a, b);
      const cosine = (-sinX * Math.cos(gy)) / length;
      if (Math.abs(cosine) > 1 || length < 0.0001) continue;
      const angle = Math.acos(cosine);
      const phase = Math.atan2(b, a);
      for (const sign of [-1, 1]) {
        const root = phase + sign * angle;
        const firstPeriod = Math.ceil((-maximumDepth * zFrequency - 1.15 - root) / (Math.PI * 2));
        const lastPeriod = Math.floor((maximumDepth * zFrequency - 1.15 - root) / (Math.PI * 2));
        for (let period = firstPeriod; period <= lastPeriod; period++) {
          const gz = phase + sign * angle + period * Math.PI * 2;
          const z = (gz + 1.15) / zFrequency;
          const polar = Math.atan2(y, z);
          const boundary =
            radius * (1 + 0.09 * Math.sin(x * 2.2 + polar * 3) + 0.04 * Math.cos(x * 4.1 - polar * 5));
          if (y * y + (z / 0.73) ** 2 > boundary * boundary) continue;
          const gradientX = cosX * Math.cos(gy) - Math.sin(gz) * sinX;
          const gradientY = -sinX * Math.sin(gy) + Math.cos(gy) * Math.cos(gz);
          const gradientZ = -Math.sin(gy) * Math.sin(gz) + Math.cos(gz) * cosX;
          const gyDerivative = y * frequency * (0.1848 * Math.cos(x * 0.77 + 0.3) + 0.12 / 6.75);
          const gzDerivative = -z * frequency * 0.1005 * Math.sin(x * 0.67 - 0.2);
          const nx = gradientX * gxDerivative + gradientY * gyDerivative + gradientZ * gzDerivative;
          const ny = gradientY * yFrequency;
          const nz = gradientZ * zFrequency;
          const normalLength = Math.hypot(nx, ny, nz);
          const seed = hash(points.length + x * 11.3 + y * 7.1 + z);
          // A coherent spatial warp breaks the perfect repeated unit cell while
          // retaining its open passages and its true three-dimensional depth.
          const warpedX = x + 0.18 * Math.sin(y * 1.7 + z * 1.3);
          const warpedY = y + 0.35 * Math.sin(x * 1.15 + z * 1.4) * along;
          const warpedZ = z + 0.3 * Math.sin(x * 0.95 + y * 1.6) * along;
          points.push(
            warpedX,
            warpedY,
            warpedZ,
            nx / normalLength,
            ny / normalLength,
            nz / normalLength,
            seed,
            0,
          );
        }
      }
    }
  }

  // Sparse parent nodes remain legible at the left of the growing volume.
  for (let column = 0; column < 67; column++) {
    const along = column / 66;
    for (let row = 0; row < 27; row++) {
      const lane = row / 26 - 0.5;
      const x = -4.85 + 3.65 * Math.pow(along, 0.72);
      const y = lane * (2.7 - 1.4 * along) - 0.68 * (1 - along);
      const z = -0.12 + Math.sin(lane * 4.0) * 0.06 * along;
      points.push(x, y, z, 0, 0, 1, hash(column * 27 + row), 1);
    }
  }
  return new Float32Array(points);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('The browser could not allocate the Swarm shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`The Swarm shader could not compile: ${detail ?? 'Unknown WebGL error'}`);
  }
  return shader;
}

export function createSwarmRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL is unavailable. The original Swarm artwork remains available.');
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
  };

  try {
    shaders.push(compileShader(gl, gl.VERTEX_SHADER, vertexSource));
    shaders.push(compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    program = gl.createProgram();
    if (!program) throw new Error('The browser could not allocate the Swarm renderer.');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `The Swarm renderer could not start: ${gl.getProgramInfoLog(program) ?? 'Unknown WebGL error'}`,
      );
    }
    gl.useProgram(program);
    const data = createPointVolume();
    const count = data.length / 8;
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('The browser could not allocate the Swarm point field.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const attribute of [
      { name: 'a_target', size: 3, offset: 0 },
      { name: 'a_normal', size: 3, offset: 3 },
      { name: 'a_identity', size: 2, offset: 6 },
    ]) {
      const location = gl.getAttribLocation(program, attribute.name);
      if (location < 0) throw new Error(`The Swarm shader is missing ${attribute.name}.`);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attribute.size, gl.FLOAT, false, 8 * 4, attribute.offset * 4);
    }
    const uniforms = {
      cover: gl.getUniformLocation(program, 'u_cover'),
      pixels: gl.getUniformLocation(program, 'u_pixels'),
      seconds: gl.getUniformLocation(program, 'u_seconds'),
      variant: gl.getUniformLocation(program, 'u_variant'),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 1);
    return {
      render(seconds: number, variant: SwarmVariant) {
        if (disposed) return;
        const elapsed = ((seconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (elapsed >= 13) return;
        gl.uniform1f(uniforms.seconds, elapsed);
        gl.uniform1f(uniforms.variant, variantNumbers[variant]);
        gl.drawArrays(gl.POINTS, 0, count);
      },
      resize(width: number, height: number, pixelRatio: number) {
        if (disposed || width <= 0 || height <= 0) return;
        const ratio = Math.max(0.25, pixelRatio);
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        gl.viewport(0, 0, canvas.width, canvas.height);
        const scale = Math.max(width / 1536, height / 1024);
        gl.uniform2f(uniforms.cover, (1536 * scale) / width, (1024 * scale) / height);
        gl.uniform1f(uniforms.pixels, scale * ratio);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
