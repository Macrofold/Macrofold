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
uniform float u_quality;
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
vec3 orient(vec3 p) {
  p.xz=rotate(p.xz,u_view.x+u_pointer.x*.12);
  p.yz=rotate(p.yz,u_view.y-u_pointer.y*.08);
  return p;
}

`;

const vertexSource = `${commonSource}
// Material coordinates travel through a closed body. Their population never
// stops at a target, and the body evaluates new anatomy at every timestamp.
vec3 transport(float time, out vec4 material, out float visible) {
  float seed=a_sample.w;
  float cycle=1.65;
  float speed=.14*(1.0+.06*sin(seed*97.0));
  float unwrapped=a_sample.x*cycle+time*speed-cycle;
  float phase=mod(max(0.0,unwrapped),cycle);
  float stopAxial=.62+.375*fract(seed*53.17);
  float stopPhase=.32+.39*(stopAxial+1.0);
  float activePhase=min(phase,stopPhase);
  float axial=clamp((activePhase-.32)/.78*2.0-1.0,-.999,.999);
  float angle=2.0*PI*a_sample.y+time*(.10+.003*sin(seed*31.0));
  angle+=.018*sin(time*.72+axial*3.0+a_sample.y*6.0);
  float layer=seed<.13 ? .54+.4*fract(seed*37.0) : 1.0;
  // A fifth of the geometric population follows actual facet intersections.
  // The remaining skin samples preserve filled faces rather than a wire cage.
  if(u_mode>4.5 && seed>.80) layer=2.0;
  float part=a_sample.z;
  material=vec4(axial,angle,layer,part);
  vec3 body=orient(volume(axial,angle,layer,part,time))*u_view.z+vec3(1020.0,530.0,0.0);
  float lane=floor(a_sample.y*26.0+.5)/26.0;
  vec3 incoming=vec3(-160.0+2050.0*phase,555.0+(lane-.5)*430.0,(part-.5)*110.0);
  float organization=smoothstep(.03,.32,phase);
  vec3 world=mix(incoming,body,organization);
  // Cohorts leave different places on the far hemisphere. They carry their
  // local tangent into a broad outward drift instead of converging on a pole.
  float departureAge=max(0.0,phase-stopPhase);
  float departure=smoothstep(0.0,.38,departureAge);
  if(departureAge>0.0) {
    vec3 before=orient(volume(stopAxial-.008,angle,layer,part,time))*u_view.z;
    vec3 end=orient(volume(stopAxial,angle,layer,part,time))*u_view.z;
    vec3 tangent=(end-before)/.008*(2.0/.78);
    float carry=(1.0-exp(-7.0*departureAge))/7.0;
    vec3 drift=vec3(1750.0,520.0*sin(angle)+(part-.5)*420.0,520.0*cos(angle));
    world+=tangent*carry+drift*(departureAge-carry);
  }
  visible=step(0.0,unwrapped)*smoothstep(0.0,180.0,world.x);
  visible*=1.0-smoothstep(1780.0,2050.0,world.x);
  visible*=mix(.60,1.0,smoothstep(.15,.62,phase));
  visible*=seed<.13 ? .32 : 1.0;
  visible*=mix(1.0,.08,departure);
  return world;
}

void main() {
  float seed=a_sample.w, time=u_time;
  float releaseAt=15.0+1.35*a_sample.y+.55*pow(sin(a_sample.y*17.0),2.0)+.45*seed;
  float attachedTime=min(time,releaseAt);
  vec4 material;
  float visibility;
  vec3 world=transport(attachedTime,material,visibility);
  float normalLayer=min(material.z,1.0);
  vec3 p=volume(material.x,material.y,normalLayer,material.w,attachedTime);
  vec3 tangentA=volume(min(.9999,material.x+.004),material.y,normalLayer,material.w,attachedTime)-p;
  vec3 tangentB=volume(material.x,material.y+.008,normalLayer,material.w,attachedTime)-p;
  vec3 normal=cross(tangentB,tangentA);
  normal=dot(normal,normal)>.0000000001 ? normalize(normal) : normalize(p+vec3(.001));
  // Annular branches parameterize opposite orientations of the same skin.
  if(u_mode>1.5 && u_mode<2.5 && material.w<.5) normal=-normal;
  if(u_mode>2.5 && u_mode<3.5 && fract(material.w*3.0)<.5) normal=-normal;
  normal=orient(normal);
  float age=max(0.0,time-releaseAt);
  if(age>0.0) {
    vec4 nextMaterial, priorMaterial;
    float unused;
    vec3 ahead=transport(releaseAt+.008,nextMaterial,unused);
    vec3 behind=transport(releaseAt-.008,priorMaterial,unused);
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
  float perspective=clamp(2000.0/(2000.0-world.z),.70,1.36);
  vec2 screen=vec2(1020.0,530.0)+(world.xy-vec2(1020.0,530.0))*perspective;
  gl_Position=vec4(screen.x/768.0-1.0,1.0-screen.y/512.0,clamp(-world.z/2000.0,-.95,.95),1.0);
  // Compact sprites preserve the particulate surface. Front/back attenuation
  // and facet normals make enclosed mass readable without a broad bloom pass.
  float facing=mix(.42,1.0,smoothstep(-.25,.5,normal.z));
  float relief=.70+.65*max(0.0,dot(normal,normalize(vec3(-.45,-.6,1.0))));
  float density=mix(.80,1.25,smoothstep(-380.0,330.0,world.z));
  float alpha=visibility*a_shape.y*facing*relief*density*2.6;
  if(material.z>1.5) alpha*=1.4;
  alpha*=1.0-smoothstep(.80+.4*seed,2.7+.5*seed,age);
  alpha*=1.0-smoothstep(19.35,20.0,time);
  float diameter=a_shape.x*u_scale*1.15*perspective;
  gl_PointSize=max(1.0,diameter);
  float warm=u_view.w+.32*smoothstep(-.2,.8,normal.x-normal.y*.3);
  vec3 field=mix(vec3(.68,.90,.97),vec3(1.0,.94,.80),warm);
  v_color=mix(field,a_color,.20);
  v_opacity=alpha*min(1.0,diameter*diameter)/sqrt(u_quality);
}
`;

// The same geometry writes depth without color. Rear and intersecting faces
// cannot show through gaps between foreground dots and blur a solid's facets.
const depthVertexSource = `${commonSource}
attribute vec3 a_mesh;
uniform float u_members;
varying highp vec2 v_material;
void main() {
  vec3 p=orient(volume(a_mesh.x,a_mesh.y,1.0,a_mesh.z/u_members,u_time));
  vec3 world=p*u_view.z+vec3(1020.0,530.0,0.0);
  float perspective=clamp(2000.0/(2000.0-world.z),.70,1.36);
  vec2 screen=vec2(1020.0,530.0)+(world.xy-vec2(1020.0,530.0))*perspective;
  gl_Position=vec4(screen.x/768.0-1.0,1.0-screen.y/512.0,
    clamp(-world.z/2000.0+.002,-.95,.95),1.0);
  v_material=vec2(a_mesh.x,a_mesh.y);
}
`;
const depthFragmentSource = `
precision mediump float;
uniform highp float u_time;
varying highp vec2 v_material;
void main() {
  float formation=.32+.39*(v_material.x+1.0);
  if(formation>u_time*.14) discard;
  float q=fract((v_material.y-u_time*.10)/6.2831853);
  float releaseAt=15.0+1.35*q+.55*pow(sin(q*17.0),2.0)+.22;
  if(u_time>releaseAt) discard;
  gl_FragColor=vec4(0.0);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_color;
varying float v_opacity;
void main() {
  vec2 d=(gl_PointCoord-.5)*6.0;
  float r=dot(d,d);
  if(r>8.8) discard;
  float alpha=clamp(v_opacity*exp(-.5*r)*(1.0-smoothstep(7.5,9.0,r)),0.0,1.0);
  if(alpha<.0039) discard;
  gl_FragColor=vec4(v_color*alpha,alpha);
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
    depth: true,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL is unavailable; the still remains available.');
  const shaders = [],
    buffers = [];
  let program,
    depthProgram,
    disposed = false,
    quality = 1;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    buffers.forEach((buffer) => gl.deleteBuffer(buffer));
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
    if (depthProgram) gl.deleteProgram(depthProgram);
  };
  try {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a volume shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'Volume shader compilation failed.');
      }
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate the volume program.');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Volume program linking failed.');
    }
    depthProgram = gl.createProgram();
    if (!depthProgram) throw new Error('Unable to allocate the volume depth program.');
    gl.attachShader(depthProgram, compile(gl.VERTEX_SHADER, depthVertexSource));
    gl.attachShader(depthProgram, compile(gl.FRAGMENT_SHADER, depthFragmentSource));
    gl.linkProgram(depthProgram);
    if (!gl.getProgramParameter(depthProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(depthProgram) || 'Volume depth program linking failed.');
    }
    const depthUniforms = Object.fromEntries(
      ['time', 'mode', 'view', 'pointer', 'members'].map((name) => [
        name,
        gl.getUniformLocation(depthProgram, `u_${name}`),
      ]),
    );
    const meshLocation = gl.getAttribLocation(depthProgram, 'a_mesh');
    if (meshLocation < 0) throw new Error('Missing volume depth attribute.');
    gl.useProgram(program);
    const uniforms = Object.fromEntries(
      ['time', 'mode', 'scale', 'quality', 'view', 'pointer'].map((name) => [
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
      if (location < 0) throw new Error(`Missing volume attribute ${name}.`);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    };
    const paletteBuffer = upload(data);
    attribute('a_color', 3, 48, 12);
    attribute('a_shape', 2, 48, 24);
    // A stratified chart supplies continuous rows. Hashes spread each row's
    // emission, component membership and depth without runtime randomness.
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
      samples.set(
        [(column + 0.15 + 0.7 * hash(i + 1)) / 200, (row + 0.5) / 200, hash(i + 40001), hash(i + 80001)],
        i * 4,
      );
    }
    const sampleBuffer = upload(samples);
    attribute('a_sample', 4, 16, 0);
    const columns = 64,
      rows = 48;
    const mesh = new Float32Array(7 * (columns + 1) * (rows + 1) * 3);
    const indices = new Uint16Array(7 * columns * rows * 6);
    let vertex = 0,
      index = 0;
    for (let member = 0; member < 7; member++) {
      const base = member * (columns + 1) * (rows + 1);
      for (let row = 0; row <= rows; row++)
        for (let column = 0; column <= columns; column++) {
          mesh.set([-1 + (2 * column) / columns, (2 * Math.PI * row) / rows, member + 0.5], vertex);
          vertex += 3;
        }
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const a = base + row * (columns + 1) + column,
            b = a + columns + 1;
          indices.set([a, b, a + 1, a + 1, b, b + 1], index);
          index += 6;
        }
    }
    const meshBuffer = upload(mesh);
    const indexBuffer = upload(indices, gl.ELEMENT_ARRAY_BUFFER);
    const bindPoints = () => {
      gl.useProgram(program);
      gl.disableVertexAttribArray(meshLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, paletteBuffer);
      attribute('a_color', 3, 48, 12);
      attribute('a_shape', 2, 48, 24);
      gl.bindBuffer(gl.ARRAY_BUFFER, sampleBuffer);
      attribute('a_sample', 4, 16, 0);
    };
    let members = 1;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const setVariation = (variation) => {
      if (disposed) return;
      const config = SURFACE_VARIATIONS.find((item) => item.id === variation.id);
      if (!config) throw new Error('Unknown volume variation.');
      members = [1, 1, 2, 6, 3, 1, 5, 7, 3, 1][config.mode];
      gl.useProgram(depthProgram);
      gl.uniform1f(depthUniforms.mode, config.mode);
      gl.uniform1f(depthUniforms.members, members);
      gl.uniform4f(depthUniforms.view, config.yaw, config.pitch, config.scale, config.warm);
      bindPoints();
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
      setQuality(fraction) {
        quality = Math.max(0.5, Math.min(1, fraction));
      },
      render(seconds, pointerX = 0, pointerY = 0) {
        if (disposed) return;
        const time = Math.max(0, seconds % 22);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (time >= 20) return;
        gl.useProgram(depthProgram);
        gl.uniform1f(depthUniforms.time, time);
        gl.uniform2f(
          depthUniforms.pointer,
          Math.max(-1, Math.min(1, pointerX)),
          Math.max(-1, Math.min(1, pointerY)),
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
        gl.enableVertexAttribArray(meshLocation);
        gl.vertexAttribPointer(meshLocation, 3, gl.FLOAT, false, 12, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.colorMask(false, false, false, false);
        gl.drawElements(gl.TRIANGLES, members * columns * rows * 6, gl.UNSIGNED_SHORT, 0);
        gl.colorMask(true, true, true, true);
        bindPoints();
        gl.uniform1f(uniforms.time, time);
        gl.uniform1f(uniforms.quality, quality);
        gl.uniform2f(
          uniforms.pointer,
          Math.max(-1, Math.min(1, pointerX)),
          Math.max(-1, Math.min(1, pointerY)),
        );
        gl.drawArrays(gl.POINTS, 0, Math.floor(40000 * quality));
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
