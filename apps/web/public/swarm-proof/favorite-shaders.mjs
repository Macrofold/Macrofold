// Exact shader programs from the approved V1 renderer (fc4fc1980126be1c).
export const favoriteVertexSource = `
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
vec2 manifold(float arc,float q) {
  vec2 p=chartPoint(arc,q);
  if(arc>1.0) {
    vec2 tangent=(p-chartPoint(510.0/511.0,q))*511.0;
    float extension=arc-1.0;
    p+=mix(tangent,vec2(1536.0,0.0),smoothstep(0.0,.4,extension))*extension;
  }
  return p;
}
vec2 rotate(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*p;
}

// A single continuous surface coordinate system. Low-frequency deformations
// bend neighboring rows together; point travel does not determine fold phase.
vec3 surface(vec2 p,float q,float time) {
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

vec3 organized(float time,out vec4 state) {
  float seed=a_identity.x;
  float speed=1.0+.035*sin(seed*137.17);
  float cycle=1.16;
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
    arc=1.0+extension*mix((1.0-priorArc)*511.0,2.5,smoothstep(0.0,.16,extension));
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
    world+=velocity*carry+wind*(age-carry);
    float curl=age-(1.0-exp(-age));
    world.xy+=vec2(sin(age*1.2+q*17.0+angle),cos(age*.9+q*11.0-angle))*curl*45.0;
  }
  float influence=1.0-exp(-4.0*pow(max(0.0,state.x)/1536.0,2.0));
  vec3 screen=project(world,influence);
  float perspective=clamp(2100.0/(2100.0-screen.z),.72,1.34);
  float alpha=state.a*smoothstep(0.0,190.0,state.x)*smoothstep(0.0,.2,time);
  alpha*=1.0-smoothstep(1810.0,2050.0,state.x);
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

export const favoriteFragmentSource = `
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
