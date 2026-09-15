import { createMaterialChart } from './material.mjs';
import { SURFACE_VARIATIONS } from './surfaces.mjs';
import { favoriteVertexSource, favoriteFragmentSource } from './favorite-shaders.mjs';

const vertexSource = `
precision highp float;
attribute vec3 a_position;
attribute vec3 a_color;
attribute vec4 a_shape;
attribute vec2 a_identity;
attribute vec4 a_material;
uniform sampler2D u_chart;
uniform sampler2D u_flow;
uniform sampler2D u_color;
uniform vec2 u_pointer;
uniform float u_scale;
uniform float u_time;
uniform float u_quality;
uniform float u_rate;
// mode / depth / fold count / torsion
uniform vec4 u_structure;
// bend / breath / cohesion / grain
uniform vec4 u_motion;
// fixed camera yaw / pitch / amber / point scale
uniform vec4 u_look;
varying vec3 v_color;
varying float v_opacity;

const float PI = 3.14159265359;
vec2 chartUv(float arc,float q) {
  return vec2((clamp(arc,0.0,1.0)*511.0+.5)/512.0,(clamp(q,0.0,1.0)*511.0+.5)/512.0);
}
vec2 chartPoint(float arc,float q) {
  vec4 encoded=texture2D(u_chart,chartUv(arc,q));
  return vec2(dot(encoded.rg,vec2(65280.0,255.0))*1536.0,dot(encoded.ba,vec2(65280.0,255.0))*1024.0)/65535.0;
}
bool preservedSurface() { return u_structure.x>6.5 && u_structure.x<8.5; }
vec2 manifold(float arc,float q) {
  vec2 p=chartPoint(arc,q);
  if(arc>1.0) {
    vec2 tangent=(p-chartPoint(510.0/511.0,q))*511.0;
    float extension=arc-1.0;
    p+=(preservedSurface()?mix(tangent,vec2(1536.0,0.0),smoothstep(0.0,.4,extension)):tangent)*extension;
  }
  return p;
}
vec2 rotate(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*p;
}

// A single continuous surface coordinate system. Low-frequency deformations
// bend neighboring rows together; point travel does not determine fold phase.
vec3 approvedSurface(vec2 p,float q,float time) {
  float u=clamp(p.x/1536.0,0.0,1.25);
  float envelope=1.0-exp(-4.0*u*u);
  float x=(u-.67)*1.6, v=q*2.0-1.0;
  float clock=(time-9.0)*.38;
  float breath=sin(clock)*u_motion.y;
  float k=u_structure.z;
  float z=0.0, roll=0.0;
  float phase=.32*breath;
  if(u_structure.x<.5) {
    // An asymmetric S-section: broad front and rear planes, joined by a fold.
    z=.72*sin(PI*(v*.82+x*.24)+phase)+.20*x*v;
    roll=.29*sin(clock*.8+v)*u_motion.x;
  } else if(u_structure.x<1.5) {
    // Opposing principal curvatures hold the saddle's four shoulders together.
    z=.72*(x*x-v*v)+.24*x*v;
    roll=.34*breath*x;
  } else if(u_structure.x<2.5) {
    // A shallow open vault, not a closed tube.
    z=.82*(1.0-v*v)-.25+.22*x*v;
    roll=.34*breath*v;
  } else if(u_structure.x<3.5) {
    // Distributed torsion leaves long, readable ruled sections.
    z=.32*sin(v*PI)+.25*x*v;
    roll=u_structure.w*x+.14*breath;
  } else if(u_structure.x<4.5) {
    // One rounded oblique crease, with wide planes on either side.
    float crease=v-.55*x;
    z=.78*sqrt(crease*crease+.045)-.48+.16*x;
    roll=.16*breath*crease/sqrt(crease*crease+.04);
  } else if(u_structure.x<5.5) {
    // Two unequal lobes form counter-curving surfaces.
    z=.66*sin(v*PI+phase)*cos(x*1.4)+.28*sin(v*PI*.5-x);
    roll=.17*breath*sin(v*PI);
  } else if(u_structure.x<6.5) {
    // A broad plane with an edge lifted and returned into the depth axis.
    float edge=smoothstep(.05,.95,v);
    z=.24*x*v+.72*edge*edge-.20;
    roll=u_structure.w*edge+.25*breath;
  } else if(u_structure.x<7.5) {
    // Conjugate bends create crossing planes without adding disconnected shells.
    z=.48*sin((v+x*.65)*PI)+.36*sin((v-x*.7)*PI*.7);
    roll=.15*breath*cos(v*PI);
  } else if(u_structure.x<8.5) {
    // Broad uneven pleats, rather than high-frequency displacement noise.
    z=.58*sin(v*k*PI*.52+.20*sin(x*2.0)+phase)+.24*sin(v*PI-x);
    roll=.12*breath*cos(v*k);
  } else {
    // A long longitudinal arc with a gentle transverse roll.
    z=.68*cos(x*1.6)+.32*v*v-.48;
    roll=u_structure.w*x*.5+.17*breath;
  }
  z+=.20*breath*(1.0-v*v);
  vec3 world=vec3(p,z*u_structure.y*1.35*envelope);
  vec2 section=vec2(p.y-590.0,world.z);
  section=rotate(section,roll*envelope);
  world.y=590.0+section.x;
  world.z=section.y;
  // Cohesive expansion changes the entire sheet while retaining its curvature.
  world.y=590.0+(world.y-590.0)*(1.0+.115*breath*envelope);
  world.x+=16.0*envelope*sin(clock*.7)*sin(q*PI);
  return world;
}

// The eight new studies change the embedding in all three axes. The source
// contributes local irregularity and density, rather than fixing the silhouette.
vec3 sculpture(vec2 p,float q,float time) {
  float u=max(0.0,p.x)/1536.0;
  float v=2.0*q-1.0, h=2.0*u-1.0;
  float envelope=1.0-exp(-6.0*u*u);
  float clock=(time-9.0)*.45;
  float breath=sin(clock)*u_motion.y;
  float detail=.66*(p.y-(657.0-150.0*u+(305.0+150.0*u)*v));
  vec3 g=vec3(p.x,570.0,0.0);
  if(u_structure.x<.5) {
    g.x+=60.0*v*v;
    g.y=590.0+180.0*sin(1.25*PI*u+.18*breath)+280.0*v+detail;
    g.z=270.0*sin(PI*v+.7*u+.3*breath);
  } else if(u_structure.x<1.5) {
    g.x+=70.0*v*v;
    g.y=555.0+(135.0+235.0*h*h)*v+detail;
    g.z=350.0*(.9*v*v-.75*h*h)+80.0*breath*v;
  } else if(u_structure.x<2.5) {
    float angle=1.35*v+.18*breath;
    g.x+=270.0*(1.0-cos(angle));
    g.y=610.0-250.0*cos(angle)+detail;
    g.z=340.0*sin(angle)+50.0*sin(u*PI+clock*.6);
  } else if(u_structure.x<3.5) {
    float angle=3.25*u-.6+.30*breath;
    g.x+=95.0*v*v;
    float bow=135.0*sin(PI*v+.5*sin(u*4.0));
    g.y=550.0+370.0*v*cos(angle)-bow*sin(angle)+detail;
    g.z=370.0*v*sin(angle)+bow*cos(angle);
  } else if(u_structure.x<4.5) {
    float crease=v-.55*h;
    g.x-=120.0*v;
    g.y=360.0+220.0*u+270.0*v+150.0*sqrt(crease*crease+.02)+detail;
    g.z=330.0*(sqrt(crease*crease+.03)-.4)+60.0*breath*crease;
  } else if(u_structure.x<5.5) {
    g.x+=90.0*sin(PI*v);
    float opposed=2.0/(1.0+exp(-5.6*v))-1.0;
    g.y=535.0+255.0*opposed+90.0*sin(2.0*PI*u+.24*breath)*v+detail;
    g.z=350.0*sin(PI*v+.22*breath)+100.0*sin(PI*u)*(1.0-v*v);
  } else if(u_structure.x<6.5) {
    float edge=smoothstep(.15,1.0,v);
    float angle=2.75*edge+.18*breath*edge;
    g.x-=260.0*edge;
    g.y=570.0+380.0*v-250.0*(angle-sin(angle))+detail;
    g.z=230.0*(1.0-cos(angle));
  } else {
    g.x+=80.0*v;
    g.y=750.0-400.0*sin(.85*PI*u+.20*breath)+180.0*v+detail;
    g.z=300.0*sin(.85*PI*u)+150.0*v*v+70.0*breath;
  }
  return mix(vec3(p,0.0),g,envelope);
}
vec3 surface(vec2 p,float q,float time) {
  if(preservedSurface()) return approvedSurface(p,q,time);
  // Continue each section's own tangent, with its full width and depth. There
  // is no common exit corridor, narrowing, or attraction to an outlet.
  vec2 edge=chartPoint(1.0,q);
  if(p.x>edge.x) {
    vec2 previous=chartPoint(510.0/511.0,q);
    vec3 end=sculpture(edge,q,time);
    vec3 tangent=(end-sculpture(previous,q,time))/max(.01,edge.x-previous.x);
    return end+tangent*(p.x-edge.x);
  }
  return sculpture(p,q,time);
}

vec3 organized(float time,out vec4 state) {
  float seed=a_identity.x;
  float speed=1.0+.035*sin(seed*137.17);
  float cycle=preservedSurface()?1.16:1.44;
  float unwrapped=a_material.y*cycle+u_rate*time*speed-cycle;
  unwrapped+=.002*(sin(time*1.3+seed*25.0)-sin(seed*25.0));
  float phase=mod(max(0.0,unwrapped),cycle);
  float band=min(63.0,floor(a_material.x*64.0));
  vec4 flow=texture2D(u_flow,vec2((min(phase,1.0)*511.0+.5)/512.0,(band+.5)/64.0));
  float arc=dot(flow.rg,vec2(65280.0,255.0))/65535.0;
  if(phase>1.0) {
    vec4 previous=texture2D(u_flow,vec2((510.0+.5)/512.0,(band+.5)/64.0));
    float priorArc=dot(previous.rg,vec2(65280.0,255.0))/65535.0;
    float extension=phase-1.0;
    float exitSlope=(1.0-priorArc)*511.0;
    arc=1.0+extension*(preservedSurface()?mix(exitSlope,2.5,smoothstep(0.0,.16,extension)):exitSlope);
  }
  float coupling=1.0-exp(-3.3*max(0.0,arc));
  // Surface meridians retain local order. Each point still has its own phase,
  // speed and small tangent displacement, including after the volume forms.
  float orderedQ=floor(a_material.x*240.0+.5)/240.0;
  float q=mix(a_material.x,orderedQ,u_motion.z);
  q+=coupling*(.00025*sin(time*.65+q*18.0+arc*4.0)
      +.00065*u_motion.w*sin(time*1.3+seed*31.0));
  q=clamp(q,.0001,.9999);
  vec2 mapped=manifold(arc,q)+a_material.zw*mix(.10,.55,u_motion.w);
  float lane=floor(a_material.x*26.0+.5)/26.0;
  mapped.y=mix(mapped.y,352.0+lane*610.0,exp(-7.0*max(0.0,arc)));
  float primary=1.0-smoothstep(.045,.065,seed);
  float mass=max(primary*.36,flow.b*4.0*(.54+.46*coupling))*cycle;
  state=vec4(mapped.x,arc,q,mass*step(0.0,unwrapped));
  return surface(mapped,q,time);
}

vec3 project(vec3 world,float influence) {
  vec3 p=world-vec3(1040.0,570.0,0.0);
  p.xz=rotate(p.xz,(u_look.x*1.6+u_pointer.x*.12)*influence);
  p.yz=rotate(p.yz,(u_look.y*1.6-u_pointer.y*.08)*influence);
  float perspective=clamp(2100.0/(2100.0-p.z),.72,1.34);
  return vec3(vec2(1040.0,570.0)+p.xy*perspective,p.z);
}
void main() {
  float time=u_time,seed=a_identity.x,q=a_material.x;
  float releaseAt=15.0+1.45*q+.45*pow(sin(q*14.0+1.0),2.0)+seed*.55;
  vec4 state;
  vec3 world=organized(min(time,releaseAt),state);
  float age=max(0.0,time-releaseAt);
  if(age>0.0) {
    vec4 nextState,previousState;
    vec3 ahead=organized(releaseAt+.008,nextState);
    vec3 behind=organized(releaseAt-.008,previousState);
    vec3 velocity=(ahead-behind)/.016;
    if(nextState.y<previousState.y)
      velocity=state.y<.5?(ahead-world)/.008:(world-behind)/.008;
    float angle=seed*6.2831853+a_position.z*4.0;
    vec3 wind=vec3(190.0+cos(angle)*115.0,-75.0+sin(angle)*115.0,sin(seed*41.0)*130.0);
    float carry=(1.0-exp(-.7*age))/.7;
    if(!preservedSurface()) {
      wind=vec3(30.0+60.0*sin(q*9.0)+cos(angle)*190.0,
        -15.0+65.0*cos(q*7.0)+sin(angle)*185.0,sin(seed*41.0)*210.0);
      carry=(1.0-exp(-.45*age))/.45;
    }
    world+=velocity*carry+wind*(age-carry);
    float curl=age-(1.0-exp(-age));
    world.xy+=vec2(sin(age*1.2+q*17.0+angle),cos(age*.9+q*11.0-angle))*curl*45.0;
  }
  float influence=1.0-exp(-4.0*pow(max(0.0,state.x)/1536.0,2.0));
  vec3 screen=project(world,influence);
  float perspective=clamp(2100.0/(2100.0-screen.z),.72,1.34);
  float alpha=state.a*smoothstep(0.0,190.0,state.x)*smoothstep(0.0,.2,time);
  alpha*=preservedSurface()?1.0-smoothstep(1810.0,2050.0,state.x):1.0-smoothstep(1740.0,2000.0,screen.x);
  alpha*=1.0-smoothstep(.75+seed*.5,2.5+seed*.65,age);
  alpha*=1.0-smoothstep(19.35,20.0,time);
  float depthPresence=mix(.80,1.08,smoothstep(-350.0,260.0,screen.z));
  gl_Position=vec4(screen.x/768.0-1.0,1.0-screen.y/512.0,clamp(-screen.z/2000.0,-.95,.95),1.0);
  float diameter=a_shape.x*u_scale*mix(.82,1.0,influence)*u_look.w*perspective;
  gl_PointSize=max(1.0,diameter);
  vec3 fieldColor=mix(a_color,texture2D(u_color,chartUv(state.y,state.z)).rgb,.9);
  fieldColor=mix(fieldColor,fieldColor*vec3(1.10,.98,.82),u_look.z);
  v_color=fieldColor;
  v_opacity=a_shape.y*alpha*depthPresence*min(1.0,diameter*diameter)/sqrt(u_quality);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_color;
varying float v_opacity;
void main(){
  vec2 d=(gl_PointCoord-.5)*6.0;
  float r=dot(d,d);
  if(r>8.8)discard;
  float coverage=exp(-.5*r);
  // Compact luminous points, without a broad bloom pass.
  coverage*=1.0-smoothstep(7.5,9.0,r);
  float alpha=clamp(v_opacity*coverage,0.0,1.0);
  if(alpha<.0039)discard;
  gl_FragColor=vec4(v_color*alpha,alpha);
}
`;

export function createRenderer(canvas, data) {
  if (!(data instanceof Float32Array) || data.length !== 40000 * 12 || !data.every(Number.isFinite)) {
    throw new Error('The particle scene is incomplete or invalid.');
  }
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: true,
    stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL is unavailable; the finished frame remains available.');
  const shaders = [], programs = [], textures = [];
  let buffer = null, materialBuffer = null, activeProgram = null;
  let disposed = false, quality = 1, scale = canvas.width / 1536;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (buffer) gl.deleteBuffer(buffer);
    if (materialBuffer) gl.deleteBuffer(materialBuffer);
    textures.forEach(texture => gl.deleteTexture(texture));
    programs.forEach(program => gl.deleteProgram(program));
    shaders.forEach(shader => gl.deleteShader(shader));
  };
  try {
    const compiledShaders = new Map();
    const compileShader = (type, source) => {
      const key = `${type}:${source}`;
      if (compiledShaders.has(key)) return compiledShaders.get(key);
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a particle shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed.');
      compiledShaders.set(key, shader);
      return shader;
    };
    const createProgram = (vertex, fragment) => {
      const program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate the particle program.');
      programs.push(program);
      gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Particle program linking failed.');
      const attributes = [['a_position', 3, 0], ['a_color', 3, 3], ['a_shape', 4, 6], ['a_identity', 2, 10], ['a_material', 4, 0]].map(([name, size, offset]) => {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) throw new Error(`Missing particle attribute ${name}.`);
        return { name, size, offset, location };
      });
      const uniforms = Object.fromEntries(['pointer', 'scale', 'time', 'quality', 'structure', 'motion', 'look', 'chart', 'flow', 'color', 'rate'].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
      return { program, attributes, uniforms };
    };
    const revisedProgram = createProgram(vertexSource, fragmentSource);
    const favoriteProgram = createProgram(favoriteVertexSource, favoriteFragmentSource);
    const programStates = [revisedProgram, favoriteProgram];
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate the point buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const chart = createMaterialChart(data);
    materialBuffer = gl.createBuffer();
    if (!materialBuffer) throw new Error('Unable to allocate the material buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, materialBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, chart.material, gl.STATIC_DRAW);
    const uploadTexture = (unit, width, height, pixels) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Unable to allocate the material field.');
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    uploadTexture(0, chart.width, chart.height, chart.pixels);
    uploadTexture(1, chart.flowWidth, chart.flowHeight, chart.flowPixels);
    uploadTexture(2, chart.width, chart.height, chart.colorPixels);
    for (const state of programStates) {
      gl.useProgram(state.program);
      gl.uniform1i(state.uniforms.chart, 0);
      gl.uniform1i(state.uniforms.flow, 1);
      gl.uniform1i(state.uniforms.color, 2);
      gl.uniform1f(state.uniforms.rate, chart.rate);
      gl.uniform1f(state.uniforms.scale, scale);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND);
    // Both programs share coverage, buffers, and textures. Favorites retain
    // their exact approved shader source, including its wind calculations.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const selectProgram = (state) => {
      if (activeProgram === state) return;
      if (activeProgram) activeProgram.attributes.forEach(attribute => gl.disableVertexAttribArray(attribute.location));
      gl.useProgram(state.program);
      // Attribute locations belong to the linked program; buffer bindings do not.
      for (const attribute of state.attributes) {
        const material = attribute.name === 'a_material';
        gl.bindBuffer(gl.ARRAY_BUFFER, material ? materialBuffer : buffer);
        gl.enableVertexAttribArray(attribute.location);
        gl.vertexAttribPointer(attribute.location, attribute.size, gl.FLOAT, false, material ? 16 : 48, attribute.offset * 4);
      }
      activeProgram = state;
    };
    const setVariation = (variation) => {
      if (disposed) return;
      const config = SURFACE_VARIATIONS.find(item => item.id === variation.id);
      if (!config) throw new Error('Unknown surface variation.');
      selectProgram(config.mode === 7 || config.mode === 8 ? favoriteProgram : revisedProgram);
      const { uniforms } = activeProgram;
      gl.uniform4f(uniforms.structure, config.mode, config.depth, config.folds, config.twist);
      gl.uniform4f(uniforms.motion, config.bend, config.breathe, config.cohesion, config.grain);
      gl.uniform4f(uniforms.look, config.yaw, config.pitch, config.hue, config.size);
    };
    setVariation(SURFACE_VARIATIONS[0]);
    return {
      setVariation,
      resize(width, height) {
        if (disposed) return;
        canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
        gl.viewport(0, 0, canvas.width, canvas.height);
        scale = canvas.width / 1536;
        for (const state of programStates) {
          gl.useProgram(state.program);
          gl.uniform1f(state.uniforms.scale, scale);
        }
        gl.useProgram(activeProgram.program);
      },
      setQuality(fraction) { quality = Math.max(.5, Math.min(1, fraction)); },
      render(seconds, pointerX = 0, pointerY = 0) {
        if (disposed) return;
        const time = Math.max(0, seconds % 22);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (time >= 20) return;
        const { uniforms } = activeProgram;
        gl.uniform1f(uniforms.time, time);
        gl.uniform1f(uniforms.quality, quality);
        gl.uniform2f(uniforms.pointer, Math.max(-1, Math.min(1, pointerX)), Math.max(-1, Math.min(1, pointerY)));
        gl.drawArrays(gl.POINTS, 0, Math.floor(40000 * quality));
      },
      readPixels() {
        const width = canvas.width, height = canvas.height;
        const bottomUp = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
        const pixels = new Uint8Array(bottomUp.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const from = ((height - y - 1) * width + x) * 4;
          const to = (y * width + x) * 4;
          const alpha = bottomUp[from + 3];
          pixels[to + 3] = alpha;
          if (alpha) for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.min(255, Math.round(bottomUp[from + channel] * 255 / alpha));
        }
        return pixels;
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
export default createRenderer;
