import { createMaterialChart } from './material.mjs';
import { SURFACE_VARIATIONS } from './variations.mjs';

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
uniform float u_mode;
// row cohesion / independent grain
uniform vec2 u_order;
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
vec2 manifold(float arc,float q) {
  vec2 p=chartPoint(arc,q);
  if(arc>1.0) {
    vec2 tangent=(p-chartPoint(510.0/511.0,q))*511.0;
    float extension=arc-1.0;
    p+=tangent*extension;
  }
  return p;
}
vec2 rotate(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*p;
}

// The reference chart supplies texture-scale irregularity. The full body is
// embedded anew at every time, with moving principal curvatures and hinges.
vec3 sculpture(vec2 p,float q,float time) {
  float u=max(0.0,p.x)/1536.0;
  // Preserve the reference's uneven spacing and open pockets in the material
  // coordinate itself, so they bend with each fold instead of flattening out.
  float referenceV=(p.y-(657.0-150.0*u))/(305.0+150.0*u);
  float v=mix(2.0*q-1.0,referenceV,.92), h=2.0*u-1.0;
  float envelope=1.0-exp(-6.0*u*u);
  float phase=(time-7.0)*.72;
  float wave=phase-1.7*u;
  float roll=0.0;
  vec3 g=vec3(p.x,560.0,0.0);
  if(u_mode<.5) {
    float bend=1.12+.42*sin(wave);
    g.x+=80.0*v*v*cos(phase*.7);
    g.y=565.0+285.0*v+95.0*sin(PI*u-phase*.6);
    g.z=(260.0+65.0*cos(wave*.8))*sin(PI*v*bend+.65*sin(wave));
    roll=.75*sin(wave*.85);
  } else if(u_mode<1.5) {
    g.x+=100.0*v*v*sin(phase*.6);
    g.y=555.0+(290.0+70.0*cos(wave))*v+70.0*sin(wave)*(1.0-v*v);
    g.z=380.0*((.35+.65*sin(phase))*v*v-(.45+.55*cos(wave))*h*h)
      +210.0*h*v*cos(phase*.65);
    roll=.62*sin(wave+.5);
  } else if(u_mode<2.5) {
    float a=v*(1.65+.45*sin(wave*.7));
    g.y=560.0+330.0*sin(a)+55.0*sin(2.0*PI*v+wave*.4);
    g.z=(310.0+65.0*sin(wave))*cos(a)-100.0
      +135.0*sin(2.0*PI*v+u*2.0-phase*.35);
    g.x+=80.0*(1.0-cos(a))*sin(wave);
    // Rotation retains its full amplitude throughout the body, while the
    // opening and section eccentricity continue to change independently.
    roll=phase+.75*sin(2.2*u-phase*.55);
  } else if(u_mode<3.5) {
    float a=3.7*u-1.1+1.15*sin(wave*.9);
    float bow=120.0*sin(PI*v+.6*sin(wave));
    g.y=560.0+345.0*v*cos(a)-bow*sin(a);
    g.z=345.0*v*sin(a)+bow*cos(a);
    g.x+=85.0*v*sin(wave+v);
  } else if(u_mode<4.5) {
    float crease=v-.5*h-.18*sin(wave);
    float hinge=1.05+.70*sin(wave*.8);
    float rounded=sqrt(crease*crease+.015);
    g.x-=110.0*v;
    g.y=510.0+295.0*v+90.0*h+100.0*rounded*cos(hinge);
    g.z=350.0*rounded*sin(hinge)-100.0+100.0*h*cos(phase);
    roll=.6*sin(phase*.7);
  } else if(u_mode<5.5) {
    float opposed=(2.0/(1.0+exp(-6.4*v))-1.0);
    g.y=555.0+265.0*opposed+65.0*sin(wave)*v;
    g.z=330.0*sin(PI*v+.7*sin(wave))+160.0*sin(PI*u-phase*.8)*(1.0-v*v);
    g.x+=110.0*sin(PI*v)*cos(wave*.8);
    roll=.9*sin(wave)*sin(PI*v*.65);
  } else if(u_mode<6.5) {
    float edge=smoothstep(-.2,1.0,v);
    float a=(2.8+1.2*sin(wave))*edge;
    g.x-=150.0*edge*cos(phase*.6);
    g.y=565.0+345.0*v-180.0*(a-sin(a));
    g.z=240.0*(1.0-cos(a))-90.0;
    roll=.58*sin(wave*.7);
  } else if(u_mode<7.5) {
    g.x+=115.0*v*cos(phase*.7);
    g.y=555.0+(320.0+45.0*sin(wave))*v+65.0*sin(PI*(1.8*v+h)+phase*.65);
    g.z=250.0*sin(PI*(1.9*v+.48*h)+.55*sin(phase))
      +165.0*sin(PI*(.8*v-1.1*h)-.85*cos(wave));
    roll=.75*sin(wave);
  } else if(u_mode<8.5) {
    float folds=2.4+.45*sin(wave*.65);
    g.x+=75.0*cos(PI*v*1.5+wave);
    g.y=555.0+(320.0+45.0*sin(phase*.75))*v+45.0*sin(PI*v+wave);
    g.z=(225.0+80.0*cos(wave*.8))*sin(PI*v*folds+.8*sin(wave));
    roll=.62*sin(wave*.8)+.22*v*cos(phase);
  } else {
    g.x+=70.0*v*sin(wave);
    g.y=650.0-260.0*sin(.95*PI*u+phase*.75)+260.0*v;
    g.z=320.0*sin(PI*u-phase*.65)+130.0*v*v*cos(wave);
    roll=.85*sin(wave*.7);
  }
  vec2 section=rotate(vec2(g.y-560.0,g.z),roll);
  g.y=560.0+section.x;
  g.z=section.y;
  // A second bending mode shifts the centerline, so a rotating section does
  // not read as rigid rotation of an otherwise stationary object.
  g.y+=55.0*sin(2.8*u-phase*.75)*envelope;
  g.z+=70.0*sin(3.2*u+phase*.63)*envelope;
  return mix(vec3(p,0.0),g,envelope);
}

vec3 surface(vec2 p,float q,float time) {
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
  float cycle=1.44;
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
    arc=1.0+extension*exitSlope;
  }
  float coupling=1.0-exp(-3.3*max(0.0,arc));
  // Surface meridians retain local order. Each point still has its own phase,
  // speed and small tangent displacement, including after the volume forms.
  float orderedQ=floor(a_material.x*240.0+.5)/240.0;
  float q=mix(a_material.x,orderedQ,u_order.x);
  q+=coupling*(.00010*sin(time*.65+q*18.0+arc*4.0)
      +.00065*u_order.y*sin(time*1.3+seed*31.0));
  q=clamp(q,.0001,.9999);
  vec2 mapped=manifold(arc,q)+a_material.zw*mix(.10,.55,u_order.y);
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
    vec3 wind=vec3(30.0+60.0*sin(q*9.0)+cos(angle)*190.0,
      -15.0+65.0*cos(q*7.0)+sin(angle)*185.0,sin(seed*41.0)*210.0);
    float carry=(1.0-exp(-.45*age))/.45;
    world+=velocity*carry+wind*(age-carry);
    float curl=age-(1.0-exp(-age));
    world.xy+=vec2(sin(age*1.2+q*17.0+angle),cos(age*.9+q*11.0-angle))*curl*45.0;
  }
  float influence=1.0-exp(-4.0*pow(max(0.0,state.x)/1536.0,2.0));
  vec3 screen=project(world,influence);
  float perspective=clamp(2100.0/(2100.0-screen.z),.72,1.34);
  float alpha=state.a*smoothstep(0.0,190.0,state.x)*smoothstep(0.0,.2,time);
  alpha*=1.0-smoothstep(1740.0,2000.0,screen.x);
  alpha*=1.0-smoothstep(.75+seed*.5,2.5+seed*.65,age);
  alpha*=1.0-smoothstep(19.35,20.0,time);
  float depthPresence=mix(.60,1.12,smoothstep(-450.0,350.0,screen.z));
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
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL is unavailable; the finished frame remains available.');
  const shaders = [],
    programs = [],
    textures = [];
  let buffer = null,
    materialBuffer = null,
    activeProgram = null;
  let disposed = false,
    quality = 1,
    scale = canvas.width / 1536;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (buffer) gl.deleteBuffer(buffer);
    if (materialBuffer) gl.deleteBuffer(materialBuffer);
    textures.forEach((texture) => gl.deleteTexture(texture));
    programs.forEach((program) => gl.deleteProgram(program));
    shaders.forEach((shader) => gl.deleteShader(shader));
  };
  try {
    const compiledShaders = new Map();
    const compileShader = (type, source) => {
      const key = `${type}:${source}`;
      if (compiledShaders.has(key)) return compiledShaders.get(key);
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a particle shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed.');
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
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || 'Particle program linking failed.');
      const attributes = [
        ['a_position', 3, 0],
        ['a_color', 3, 3],
        ['a_shape', 4, 6],
        ['a_identity', 2, 10],
        ['a_material', 4, 0],
      ].map(([name, size, offset]) => {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) throw new Error(`Missing particle attribute ${name}.`);
        return { name, size, offset, location };
      });
      const uniforms = Object.fromEntries(
        [
          'pointer',
          'scale',
          'time',
          'quality',
          'mode',
          'order',
          'look',
          'chart',
          'flow',
          'color',
          'rate',
        ].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]),
      );
      return { program, attributes, uniforms };
    };
    const revisedProgram = createProgram(vertexSource, fragmentSource);
    const programStates = [revisedProgram];
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate the point buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    // Compact point coverage supplies density highlights on the moving sheets.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const selectProgram = (state) => {
      if (activeProgram === state) return;
      if (activeProgram)
        activeProgram.attributes.forEach((attribute) => gl.disableVertexAttribArray(attribute.location));
      gl.useProgram(state.program);
      // Attribute locations belong to the linked program; buffer bindings do not.
      for (const attribute of state.attributes) {
        const material = attribute.name === 'a_material';
        gl.bindBuffer(gl.ARRAY_BUFFER, material ? materialBuffer : buffer);
        gl.enableVertexAttribArray(attribute.location);
        gl.vertexAttribPointer(
          attribute.location,
          attribute.size,
          gl.FLOAT,
          false,
          material ? 16 : 48,
          attribute.offset * 4,
        );
      }
      activeProgram = state;
    };
    const setVariation = (variation) => {
      if (disposed) return;
      const config = SURFACE_VARIATIONS.find((item) => item.id === variation.id);
      if (!config) throw new Error('Unknown surface variation.');
      selectProgram(revisedProgram);
      const { uniforms } = activeProgram;
      gl.uniform1f(uniforms.mode, config.mode);
      gl.uniform2f(uniforms.order, config.cohesion, config.grain);
      gl.uniform4f(uniforms.look, config.yaw, config.pitch, config.hue, config.size);
    };
    setVariation(SURFACE_VARIATIONS[0]);
    return {
      setVariation,
      resize(width, height) {
        if (disposed) return;
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        gl.viewport(0, 0, canvas.width, canvas.height);
        scale = canvas.width / 1536;
        for (const state of programStates) {
          gl.useProgram(state.program);
          gl.uniform1f(state.uniforms.scale, scale);
        }
        gl.useProgram(activeProgram.program);
      },
      setQuality(fraction) {
        quality = Math.max(0.5, Math.min(1, fraction));
      },
      render(seconds, pointerX = 0, pointerY = 0) {
        if (disposed) return;
        const time = Math.max(0, seconds % 22);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (time >= 20) return;
        const { uniforms } = activeProgram;
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
              for (let channel = 0; channel < 3; channel++)
                pixels[to + channel] = Math.min(255, Math.round((bottomUp[from + channel] * 255) / alpha));
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
