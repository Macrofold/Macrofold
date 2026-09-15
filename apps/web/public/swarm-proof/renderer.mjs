import { createMaterialChart } from './material.mjs';

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
varying vec3 v_color;
varying float v_opacity;

vec2 chartUv(float arc,float q) {
  return vec2((clamp(arc,0.0,1.0)*511.0+.5)/512.0,(clamp(q,0.0,1.0)*511.0+.5)/512.0);
}
vec2 manifold(float arc,float q) {
  vec4 encoded=texture2D(u_chart,chartUv(arc,q));
  vec2 p=vec2(dot(encoded.rg,vec2(65280.0,255.0))*1536.0,dot(encoded.ba,vec2(65280.0,255.0))*1024.0)/65535.0;
  // Match the endpoint tangent before turning into the offscreen corridor.
  // The terminal position remains far beyond the crop when identity wraps.
  if(arc>1.0) {
    vec4 previous=texture2D(u_chart,chartUv(510.0/511.0,q));
    vec2 prior=vec2(dot(previous.rg,vec2(65280.0,255.0))*1536.0,dot(previous.ba,vec2(65280.0,255.0))*1024.0)/65535.0;
    vec2 tangent=(p-prior)*511.0;
    float extension=arc-1.0;
    p+=mix(tangent,vec2(1536.0,0.0),smoothstep(0.0,.4,extension))*extension;
  }
  return p;
}
vec2 rotate(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*p;
}
vec2 fold(vec2 p,float time) {
  float progress=clamp(p.x/1536.0,0.0,1.0);
  float influence=1.0-exp(-3.0*progress*progress);
  float clock=time-9.0;
  vec2 material=p,center=vec2(1160.0,490.0),r=p-center;
  float weight=exp(-dot(r/vec2(500.0,600.0),r/vec2(500.0,600.0)));
  p=center+rotate(r,.40*sin(clock*.61)*weight*influence);
  p.x+=influence*(74.0*(sin(material.y*.0057+clock*.58)-sin(material.y*.0057))
      +34.0*(sin(material.x*.0042-material.y*.003+clock*.43)-sin(material.x*.0042-material.y*.003)));
  p.y+=influence*(73.0*(sin(material.x*.0045-clock*.54)-sin(material.x*.0045))
      +38.0*(cos(material.y*.006+material.x*.002+clock*.72)-cos(material.y*.006+material.x*.002)));
  p.y=610.0+(p.y-610.0)*(1.0+influence*.13*sin(clock*.86));
  return p;
}
vec2 organized(float time,out vec4 state) {
  float seed=a_identity.x;
  float speed=1.0+.055*sin(seed*137.17);
  float cycle=1.16;
  // Uniform emission phases give a steady ensemble even though each identity
  // passes completely through the image. There is no timed hold or slowdown.
  float unwrapped=a_material.y*cycle+u_rate*time*speed-cycle;
  unwrapped+=.003*(sin(time*1.3+seed*25.0)-sin(seed*25.0));
  float phase=mod(max(0.0,unwrapped),cycle);
  float band=min(63.0,floor(a_material.x*64.0));
  vec4 flow=texture2D(u_flow,vec2((min(phase,1.0)*511.0+.5)/512.0,(band+.5)/64.0));
  float arc=dot(flow.rg,vec2(65280.0,255.0))/65535.0;
  if(phase>1.0) {
    vec4 previous=texture2D(u_flow,vec2((510.0+.5)/512.0,(band+.5)/64.0));
    float priorArc=dot(previous.rg,vec2(65280.0,255.0))/65535.0;
    float endpointSlope=(1.0-priorArc)*511.0;
    float extension=phase-1.0;
    arc=1.0+extension*mix(endpointSlope,2.5,smoothstep(0.0,.16,extension));
  }
  float coupling=1.0-exp(-3.3*max(0.0,arc));
  // Close neighbors share broad phase tendencies. Individual offsets and
  // velocities persist within that order instead of being switched off.
  float q=a_material.x;
  float alignment=.0015*sin(time*.83+q*24.0+arc*9.0);
  float individual=.0011*sin(time*1.7+seed*31.0)+.0007*cos(time*2.1+seed*19.0);
  q=clamp(q+coupling*(alignment+individual),.0001,.9999);
  vec2 mapped=manifold(arc,q)+a_material.zw;
  float lane=floor(a_material.x*26.0+.5)/26.0;
  float laneMemory=exp(-7.0*max(0.0,arc));
  mapped.y=mix(mapped.y,352.0+lane*610.0,laneMemory);
  float primary=1.0-smoothstep(.045,.065,seed);
  float mass=max(primary*.30,flow.b*4.0*(.5+.5*coupling))*cycle;
  state=vec4(mapped.x,arc,q,mass*step(0.0,unwrapped));
  return fold(mapped,time);
}
void main() {
  float time=u_time,seed=a_identity.x;
  // A wind front crosses neighboring layers, with local differences in how
  // long they retain cohesion. Undetached particles keep streaming/folding.
  float q=a_material.x;
  float releaseAt=15.0+1.45*q+.45*pow(sin(q*14.0+1.0),2.0)+seed*.55;
  float sampleTime=min(time,releaseAt);
  vec4 state;
  vec2 p=organized(sampleTime,state);
  float age=max(0.0,time-releaseAt);
  if(age>0.0) {
    vec4 nextState,previousState;
    vec2 ahead=organized(releaseAt+.008,nextState);
    vec2 behind=organized(releaseAt-.008,previousState);
    vec2 velocity=(ahead-behind)/.016;
    // Only a wrapped material coordinate needs a one-sided derivative.
    // Ordinary high velocities preserve their direction and momentum.
    if(nextState.y<previousState.y)velocity=state.y<.5?(ahead-p)/.008:(p-behind)/.008;
    float angle=seed*6.2831853+a_position.z*4.0;
    vec2 wind=vec2(190.0,-75.0)+vec2(cos(angle),sin(angle))*115.0;
    float carry=(1.0-exp(-.7*age))/.7;
    p+=velocity*carry+wind*(age-carry);
    float curl=age-(1.0-exp(-age));
    p+=vec2(sin(age*1.2+q*17.0+angle),cos(age*.9+q*11.0-angle))*curl*45.0;
  }
  float alpha=state.a*smoothstep(0.0,190.0,state.x)*smoothstep(0.0,.2,time);
  // Recycle only after the entire moving fold has crossed the right crop.
  alpha*=1.0-smoothstep(1810.0,2050.0,state.x);
  alpha*=1.0-smoothstep(.75+seed*.5,2.5+seed*.65,age);
  alpha*=1.0-smoothstep(19.35,20.0,time);
  float influence=1.0-exp(-3.0*max(0.0,state.y));
  p+=u_pointer*a_position.z*9.0*influence;
  gl_Position=vec4(p.x/768.0-1.0,1.0-p.y/512.0,0.0,1.0);
  float diameter=a_shape.x*u_scale*mix(.82,1.0,influence);
  gl_PointSize=max(1.0,diameter);
  v_color=mix(a_color,texture2D(u_color,chartUv(state.y,state.z)).rgb,.86);
  v_opacity=a_shape.y*alpha*min(1.0,diameter*diameter)/sqrt(u_quality);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_color;
varying float v_opacity;
void main(){
  vec2 d=(gl_PointCoord-.5)*6.0;
  float r=dot(d,d);
  float coverage=exp(-.5*r);
  // Compact luminous points, without a broad bloom pass.
  coverage*=1.0-smoothstep(7.5,9.0,r);
  float alpha=clamp(v_opacity*coverage,0.0,1.0);
  gl_FragColor=vec4(v_color*alpha,alpha);
}
`;

export function createRenderer(canvas, data) {
  if (!(data instanceof Float32Array) || data.length !== 40000 * 12 || !data.every(Number.isFinite)) {
    throw new Error('The particle scene is incomplete or invalid.');
  }
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL is unavailable; the finished frame remains available.');
  const shaders = [];
  let program = null, buffer = null, materialBuffer = null, chartTexture = null, flowTexture = null, colorTexture = null, disposed = false, quality = 1;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (buffer) gl.deleteBuffer(buffer);
    if (materialBuffer) gl.deleteBuffer(materialBuffer);
    if (chartTexture) gl.deleteTexture(chartTexture);
    if (flowTexture) gl.deleteTexture(flowTexture);
    if (colorTexture) gl.deleteTexture(colorTexture);
    if (program) gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
  };
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a particle shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed.');
    }
    program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate the particle program.');
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Particle program linking failed.');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate the point buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [name, size, offset] of [['a_position', 3, 0], ['a_color', 3, 3], ['a_shape', 4, 6], ['a_identity', 2, 10]]) {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) throw new Error(`Missing particle attribute ${name}.`);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 48, offset * 4);
    }
    const chart = createMaterialChart(data);
    materialBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, materialBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, chart.material, gl.STATIC_DRAW);
    const materialLocation = gl.getAttribLocation(program, 'a_material');
    gl.enableVertexAttribArray(materialLocation);
    gl.vertexAttribPointer(materialLocation, 4, gl.FLOAT, false, 16, 0);
    const uploadTexture = (unit, name, width, height, pixels) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Unable to allocate the material field.');
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
      return texture;
    };
    chartTexture = uploadTexture(0, 'u_chart', chart.width, chart.height, chart.pixels);
    flowTexture = uploadTexture(1, 'u_flow', chart.flowWidth, chart.flowHeight, chart.flowPixels);
    colorTexture = uploadTexture(2, 'u_color', chart.width, chart.height, chart.colorPixels);
    gl.uniform1f(gl.getUniformLocation(program, 'u_rate'), chart.rate);
    const uniforms = Object.fromEntries(['pointer', 'scale', 'time', 'quality'].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    // Premultiplied coverage stays valid over arbitrary page colors. Crowded
    // point cores accumulate brightness without a full-surface bloom pass.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return {
      resize(width, height) {
        if (disposed) return;
        canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform1f(uniforms.scale, canvas.width / 1536);
      },
      setQuality(fraction) { quality = Math.max(.5, Math.min(1, fraction)); },
      render(seconds, pointerX = 0, pointerY = 0) {
        if (disposed) return;
        const time = Math.max(0, seconds % 22);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (time >= 20) return;
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
