import { SURFACE_VARIATIONS } from './variations.mjs';
import { volumeShapes } from './shapes.mjs';

const commonSource = `
precision highp float;
attribute vec3 a_color;
attribute vec2 a_shape;
attribute vec4 a_sample;
uniform float u_time;
uniform float u_mode;
uniform float u_scale;
uniform vec4 u_view;
uniform vec2 u_pointer;
varying vec3 v_color;
varying float v_opacity;
const float PI = 3.14159265359;

vec2 rotate(vec2 p, float angle) {
  float c=cos(angle), s=sin(angle);
  return mat2(c,s,-s,c)*p;
}
${volumeShapes}

vec3 volume(float axial, float angle, float layer, float part, float time) {
  if(u_mode<4.5) return organicVolume(axial,angle,layer,part,time,u_mode);
  return polyhedralVolume(axial,angle,layer,part,time,u_mode-5.0);
}
float sectionOrder(float part, float time) {
  if(u_mode<4.5) return organicOrder(part,time,u_mode);
  return polyhedralOrder(part,time,u_mode-5.0);
}
float sectionPresence(float part, float time) {
  if(u_mode<4.5) return organicPresence(part,time,u_mode);
  return polyhedralPresence(part,time,u_mode-5.0);
}
float gathering(float time) {
  return smoothstep(1.0,7.0,time);
}
float entryOrder(float phase, float angle, float part) {
  float start=.20+.06*(.5+.5*sin(angle*2.0+part*13.0));
  float end=.65+.16*(.5+.5*cos(angle*1.7-part*11.0));
  return smoothstep(start,end,phase);
}
// Three crossing waves provide a shared wandering field.
// Neighboring material coordinates receive related movement; fine drift stays
// individual. Gathering attenuates this field rather than assigning final slots.
vec3 wandering(vec3 p, float time) {
  return vec3(sin(p.y*2.1+time*.63)+cos(p.z*1.7-time*.47),
              sin(p.z*2.2+time*.49)+cos(p.x*1.9-time*.61),
              sin(p.x*2.0+time*.57)+cos(p.y*1.8+time*.43));
}
vec3 orient(vec3 p) {
  p.xz=rotate(p.xz,u_view.x+u_pointer.x*.12);
  p.yz=rotate(p.yz,u_view.y-u_pointer.y*.08);
  return p;
}

`;

const vertexSource = `${commonSource}
// The stream first occupies a broad wandering field. Regional order grows
// after the field is populated, and later ebbs independently for each section.
vec3 transport(float time, out vec4 material, out float visible, out float cohesion) {
  float seed=a_sample.w;
  float cycle=1.85;
  float speed=.205;
  float unwrapped=a_sample.x*cycle+time*speed-cycle;
  float phase=mod(max(0.0,unwrapped),cycle);
  float stopAxial=.42+.53*fract(seed*53.17);
  float stopPhase=.12+.62*(stopAxial+1.0);
  float activePhase=min(phase,stopPhase);
  float axial=clamp((activePhase-.12)/.62-1.0,-.999,.999);
  float angle=2.0*PI*a_sample.y+time*(.13+.012*sin(seed*31.0));
  angle+=.032*sin(time*.72+axial*3.0+a_sample.y*6.0);
  float layer=seed<.13 ? .54+.4*fract(seed*37.0) : 1.0;
  if(u_mode>4.5 && seed>.80) layer=2.0;
  float part=a_sample.z;
  material=vec4(axial,angle,layer,part);
  vec3 body=orient(volume(axial,angle,layer,part,time))*u_view.z+vec3(1020.0,530.0,0.0);
  float lane=floor(a_sample.y*26.0+.5)/26.0;
  vec3 stream=vec3(-160.0+1850.0*phase,540.0+(lane-.5)*430.0,(part-.5)*180.0);
  float spread=smoothstep(140.0,650.0,stream.x);
  float regional=sectionOrder(part,time);
  float entering=entryOrder(activePhase,angle,part);
  float guidance=gathering(time)*entering;
  cohesion=guidance*regional;
  vec3 field=wandering(vec3(activePhase*2.2,angle*.42,part*3.0),time);
  vec3 drift=vec3(sin(seed*41.0+time*.44),cos(seed*57.0-time*.51),sin(seed*73.0+time*.39));
  // Sections lose their skin into the same moving population before reforming.
  // No sharp spatial handoff or birth front exposes a finished mesh underneath.
  float surfaceExponent=u_mode>4.5 ? 4.0 : 2.0;
  float gatheringStrength=guidance*(1.0-.38*pow(1.0-regional,surfaceExponent));
  vec3 world=mix(stream,body,gatheringStrength);
  world+=(field*105.0+drift*72.0)*pow(1.0-cohesion,surfaceExponent)*spread;
  // Coherent rows share inlet positions; small differences emerge only after
  // leaving the lattice, so the incoming grid dissolves instead of snapping.
  world+=vec3(sin(seed*79.0),sin(seed*47.0),cos(seed*59.0))
    *18.0*spread*(1.0-guidance);
  float departureAge=max(0.0,phase-stopPhase);
  float departure=smoothstep(0.0,.44,departureAge);
  if(departureAge>0.0) {
    vec3 before=orient(volume(stopAxial-.008,angle,layer,part,time))*u_view.z;
    vec3 end=orient(volume(stopAxial,angle,layer,part,time))*u_view.z;
    vec3 tangent=(end-before)/.008/.62;
    tangent*=min(1.0,1700.0/max(1.0,length(tangent)));
    float carry=(1.0-exp(-7.0*departureAge))/7.0;
    vec3 outward=vec3(1900.0,570.0*sin(angle)+(part-.5)*480.0,580.0*cos(angle));
    world+=(tangent*carry+outward*(departureAge-carry))*gatheringStrength;
  }
  visible=step(0.0,unwrapped)*smoothstep(0.0,180.0,world.x);
  visible*=1.0-smoothstep(1760.0,2160.0,world.x);
  visible*=mix(.58,1.0,smoothstep(.12,.65,phase));
  visible*=seed<.13 ? .32 : 1.0;
  visible*=mix(1.0,.10,departure);
  float looseBrightness=mix(.70,.26,gathering(time));
  visible*=mix(looseBrightness,1.0,smoothstep(.30,.92,cohesion));
  visible*=mix(1.0,sectionPresence(part,time),smoothstep(.25,.90,guidance));
  return world;
}

void main() {
  float seed=a_sample.w, time=u_time;
  float releaseAt=15.0+.85*a_sample.y+.40*pow(sin(a_sample.y*17.0),2.0)+.30*seed;
  float attachedTime=min(time,releaseAt);
  vec4 material;
  float visibility, cohesion;
  vec3 world=transport(attachedTime,material,visibility,cohesion);
  // A broad normal sample gently distinguishes the surface's orientations.
  // This is sprite attenuation only: no invisible face masks another layer.
  float normalLayer=min(material.z,1.0);
  vec3 p=volume(material.x,material.y,normalLayer,material.w,attachedTime);
  vec3 tangentA=volume(min(.999,material.x+.02),material.y,normalLayer,material.w,attachedTime)-p;
  vec3 tangentB=volume(material.x,material.y+.032,normalLayer,material.w,attachedTime)-p;
  vec3 normal=cross(tangentB,tangentA);
  normal=dot(normal,normal)>1.e-12 ? normalize(normal) : vec3(0.0,0.0,1.0);
  normal=orient(normal);
  float age=max(0.0,time-releaseAt);
  if(age>0.0) {
    vec4 nextMaterial, priorMaterial;
    float unused, unusedOrder;
    vec3 ahead=transport(releaseAt+.008,nextMaterial,unused,unusedOrder);
    vec3 behind=transport(releaseAt-.008,priorMaterial,unused,unusedOrder);
    vec3 velocity=(ahead-behind)/.016;
    if(nextMaterial.x<priorMaterial.x-.1) velocity=vec3(240.0,0.0,0.0);
    velocity*=min(1.0,900.0/max(1.0,length(velocity)));
    float angle=seed*2.0*PI+a_sample.z*7.0;
    vec3 wind=vec3(40.0+175.0*cos(angle),190.0*sin(angle),210.0*sin(seed*47.0));
    float carry=(1.0-exp(-.45*age))/.45;
    world+=velocity*carry+wind*(age-carry);
    world.xy+=vec2(sin(age+seed*19.0),cos(age*.8+a_sample.y*13.0))
      *(age-(1.0-exp(-age)))*48.0;
  }
  // Orthographic projection: moving in depth never changes a particle's
  // diameter, opacity, or the population. Depth reads through changing geometry.
  vec2 screen=world.xy;
  gl_Position=vec4(screen.x/768.0-1.0,1.0-screen.y/512.0,0.0,1.0);
  float facing=.28+.72*smoothstep(-.8,.8,normal.z);
  float surfaceLight=mix(1.0,facing,cohesion*(1.0-smoothstep(0.0,2.0,age)));
  float alpha=visibility*a_shape.y*.86*surfaceLight;
  alpha*=smoothstep(0.0,170.0,screen.x);
  if(material.z>1.5) alpha*=1.12;
  alpha*=1.0-smoothstep(.65+.3*seed,2.35+.4*seed,age);
  alpha*=1.0-smoothstep(18.3,19.0,time);
  float diameter=(2.4+.24*a_shape.x)*u_scale;
  gl_PointSize=max(1.0,diameter);
  float warm=u_view.w+.16*(.5+.5*sin(a_sample.y*11.0+a_sample.z*7.0));
  vec3 field=mix(vec3(.68,.90,.97),vec3(1.0,.94,.80),warm);
  v_color=mix(field,a_color,.20);
  v_opacity=alpha*min(1.0,diameter*diameter);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_color;
varying float v_opacity;
void main() {
  vec2 d=(gl_PointCoord-.5)*2.0;
  float r=dot(d,d);
  if(r>=1.0) discard;
  // A circular silhouette and shallow hemispheric light read as tiny orbs.
  // The highlight belongs to each particle, never to its camera distance.
  float dome=sqrt(max(0.0,1.0-r));
  float highlight=pow(max(0.0,dot(vec3(d,dome),normalize(vec3(-.35,.45,1.0)))),18.0);
  float alpha=clamp(v_opacity*(1.0-smoothstep(.64,1.0,r)),0.0,1.0);
  vec3 color=v_color*(.68+.32*dome)+vec3(.16)*highlight;
  gl_FragColor=vec4(color*alpha,alpha);
}
`;

export function createRenderer(canvas, data) {
  if (!(data instanceof Float32Array) || data.length !== 40000 * 12 || !data.every(Number.isFinite)) {
    throw new Error('The particle palette is incomplete or invalid.');
  }
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL is unavailable; the still remains available.');
  const shaders = [],
    buffers = [];
  let program,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    buffers.forEach((buffer) => gl.deleteBuffer(buffer));
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
  };
  try {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a particle shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed.');
      }
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate the particle program.');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Particle program linking failed.');
    }
    gl.useProgram(program);
    const uniforms = Object.fromEntries(
      ['time', 'mode', 'scale', 'view', 'pointer'].map((name) => [
        name,
        gl.getUniformLocation(program, `u_${name}`),
      ]),
    );
    const upload = (values, target = gl.ARRAY_BUFFER) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to allocate the point buffer.');
      buffers.push(buffer);
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, values, gl.STATIC_DRAW);
      return buffer;
    };
    const attribute = (name, size, stride, offset) => {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) throw new Error(`Missing particle attribute ${name}.`);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    };
    upload(data);
    attribute('a_color', 3, 48, 12);
    attribute('a_shape', 2, 48, 24);
    // Evenly spaced columns and shared inlet lanes make a coherent lattice.
    // Stable hashes distribute those same particles among the evolving volumes.
    const samples = new Float32Array(40000 * 4);
    const hash = (value) => {
      let n = Math.imul(value ^ 0x9e3779b9, 0x21f0aaad);
      n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
      return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 40000; i++) {
      const cell = (i * 19733) % 40000;
      const row = cell % 200,
        column = Math.floor(cell / 200);
      samples.set([(column + 0.5) / 200, (row + 0.5) / 200, hash(i + 40001), hash(i + 80001)], i * 4);
    }
    upload(samples);
    attribute('a_sample', 4, 16, 0);
    // Only visible sprites participate in compositing. There is no invisible
    // solid mesh and no depth buffer that can cut away another surface's dots.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const setVariation = (variation) => {
      if (disposed) return;
      const config = SURFACE_VARIATIONS.find((item) => item.id === variation.id);
      if (!config) throw new Error('Unknown metamorphosis variation.');
      gl.useProgram(program);
      gl.uniform1f(uniforms.mode, config.mode);
      gl.uniform4f(uniforms.view, config.yaw, config.pitch, config.scale, config.warm);
    };
    setVariation(SURFACE_VARIATIONS[0]);
    gl.uniform1f(uniforms.scale, canvas.width / 1536);
    return {
      setVariation,
      resize(width, height) {
        if (disposed) return;
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform1f(uniforms.scale, canvas.width / 1536);
      },
      render(seconds, pointerX = 0, pointerY = 0) {
        if (disposed) return;
        const time = Math.max(0, seconds % 20);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (time >= 19) return;
        gl.useProgram(program);
        gl.uniform1f(uniforms.time, time);
        gl.uniform2f(
          uniforms.pointer,
          Math.max(-1, Math.min(1, pointerX)),
          Math.max(-1, Math.min(1, pointerY)),
        );
        gl.drawArrays(gl.POINTS, 0, 40000);
      },
      readPixels() {
        const width = canvas.width,
          height = canvas.height;
        const bottomUp = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
        const pixels = new Uint8Array(bottomUp.length);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const from = ((height - y - 1) * width + x) * 4;
            const to = (y * width + x) * 4;
            const alpha = bottomUp[from + 3];
            pixels[to + 3] = alpha;
            if (alpha)
              for (let channel = 0; channel < 3; channel++) {
                pixels[to + channel] = Math.min(255, Math.round((bottomUp[from + channel] * 255) / alpha));
              }
          }
        return pixels;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
export default createRenderer;
