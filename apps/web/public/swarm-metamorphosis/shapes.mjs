export const volumeShapes = `
// Stable particle identities travel through sections that change their skin,
// proportions, and attachment to neighboring regions throughout the loop.
float organicMember(float part, float mode) {
  float count = mode < 0.5 ? 6.0 : mode < 1.5 ? 7.0 : mode < 2.5 ? 5.0 : 6.0;
  return min(count - 1.0, floor(part * count));
}

float organicOrder(float part, float time, float mode) {
  float region = part * (4.7 + 0.31 * mode);
  return 0.93 + 0.045 * sin(time * 0.38 - region)
    + 0.020 * sin(time * 0.23 + 1.7 * region + mode);
}

float organicLife(float member, float time, float mode) {
  float clock = time - 7.0;
  float phase = clock * 1.02 - member * 1.31 + mode * 0.57;
  phase += 0.34 * sin(clock * 0.53 + member * 0.91 + mode * 0.41);
  return 0.5 + 0.5 * sin(phase);
}

float organicPresence(float part, float time, float mode) {
  return 0.16 + 0.84 * organicLife(organicMember(part, mode), time, mode);
}

float organicOrientation(float part, float mode) {
  return 1.0;
}

vec3 organicTurn(vec3 p, vec3 angles) {
  p.xy = rotate(p.xy, angles.z);
  p.xz = rotate(p.xz, angles.y);
  p.yz = rotate(p.yz, angles.x);
  return p;
}

float organicSignedPower(float x, float power) {
  // A finite slope at the crossing keeps throughflow from snapping at creases.
  return x * pow(x * x + 0.0016, (power - 1.0) * 0.5);
}

float organicCap(float a) {
  // Keep axial velocity finite as a surface narrows at either end.
  float span = max(0.0, 1.0 - a * a);
  return span * inversesqrt(span + 0.0036);
}

// Two muscular shoulders with a migrating cleft and unequal transverse ridges.
vec3 organicMuscle(float a, float angle, float layer, float phase) {
  float cap = organicCap(a);
  float cleft = a - 0.31 * sin(phase * 0.73);
  float pinch = 0.13 + 0.23 * (0.5 + 0.5 * cos(phase * 0.81));
  float radius = cap * (0.62 + 0.12 * sin(phase * 0.62) - pinch * exp(-8.0 * cleft * cleft));
  radius *= 1.0 + 0.17 * cos(3.0 * angle + 1.6 * a - phase)
    + 0.06 * cos(5.0 * angle - 2.0 * a + phase * 0.69);
  vec3 p = vec3(0.89 * a, radius * cos(angle) * layer, radius * sin(angle) * layer);
  p.y += cap * (0.29 * sin(2.5 * a - phase) + 0.10 * sin(4.0 * a + phase * 0.6));
  p.z += cap * 0.31 * cos(2.8 * a + phase * 0.8);
  return p;
}

// A thick vaulted skin with a real invaginated pocket, not a mesh cut-out.
vec3 organicVault(float a, float angle, float layer, float phase) {
  float cap = organicCap(a);
  float y = cap * cos(angle) * (0.67 + 0.21 * sin(2.0 * a + phase));
  float z = cap * sin(angle) * (0.33 + 0.13 * cos(2.7 * a - phase));
  float front = max(0.0, sin(angle));
  float pocketX = a - 0.34 * sin(phase * 0.8);
  float pocket = exp(-4.5 * pocketX * pocketX - 5.5 * y * y);
  z -= (0.39 + 0.24 * cos(phase)) * pocket * front * front;
  z += (0.19 + 0.25 * sin(phase * 0.71)) * (a * a - 0.55 * y * y);
  z += 0.18 * cap * cos(4.2 * a + phase);
  return vec3(0.91 * a, y * layer, z * layer);
}

vec3 organicWindfront(float a, float angle, float layer, float phase, float member) {
  float cap = organicCap(a);
  float cross = cap * cos(angle);
  float width = 0.39 + 0.17 * sin(2.4 * a - phase);
  float y = cross * width;
  float envelope = 0.24 + 0.085 * cos(3.8 * a + phase * 0.7);
  float z = cap * sin(angle) * envelope * layer;
  z += (0.29 + 0.18 * sin(phase * 0.71 + member)) * sin(3.1 * a + 1.8 * cross - phase)
    + 0.18 * sin(5.0 * a - 1.3 * cross + phase * 0.6);
  y += cap * 0.23 * sin(2.1 * a + phase * 0.77 + member);
  return vec3(1.06 * a + 0.07 * cap * sin(2.0 * angle - phase), y * layer, z);
}

vec3 organicFlux(float a, float angle, float layer, float phase, float shell) {
  float cap = organicCap(a);
  float saddle = a - 0.29 * sin(phase * 0.71);
  float left = exp(-5.0 * (saddle + 0.46) * (saddle + 0.46));
  float right = exp(-5.0 * (saddle - 0.46) * (saddle - 0.46));
  float transfer = 0.65 * sin(phase * 0.83);
  float shoulder = 0.23 + 0.34 * (1.0 + transfer) * left + 0.34 * (1.0 - transfer) * right;
  float pole = angle + (0.70 + 0.44 * sin(phase * 0.67)) * sin(2.1 * a - phase * 0.7);
  float radius = cap * shoulder * (1.0 + 0.17 * cos(4.0 * pole + 2.0 * a + phase));
  vec3 p = vec3(1.10 * a, radius * cos(pole), 0.76 * radius * sin(pole));
  p.yz *= (0.68 + 0.085 * shell) * layer;
  p.y += 0.34 * cap * sin(2.6 * a - phase);
  p.z += 0.29 * cap * sin(2.2 * a + phase * 0.63);
  p.x += 0.21 * cap * cos(2.0 * pole - phase);
  return p;
}

vec3 organicInterference(float a, float angle, float layer, float phase, float member) {
  float cap = organicCap(a);
  float lane = mod(member, 3.0) - 1.0;
  float crossSection = cap * organicSignedPower(cos(angle), 0.82);
  float crest = 3.8 * a + lane * 1.45 - phase;
  float width = 0.33 + 0.13 * cos(crest);
  float thickness = 0.25 + 0.09 * sin(crest + 0.8);
  vec3 p = vec3(1.04 * a, crossSection * width * layer, cap * sin(angle) * thickness * layer);
  // Traveling ridges are offset across neighboring lanes, so intersections
  // open into alternating troughs rather than six copies of a central lobe.
  p.z += (0.30 + 0.14 * sin(phase * 0.77)) * sin(crest + 1.8 * crossSection)
    + 0.19 * sin(2.3 * a - 2.6 * crossSection + phase * 0.63);
  p.y += 0.19 * cap * sin(2.7 * a + phase * 0.71 + lane);
  return p;
}

vec3 organicVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float a = clamp(axial, -1.0, 1.0);
  float member = organicMember(part, mode);
  float phase = (time - 7.0) * 0.88 - member * 0.94;
  float wave = sin(phase);
  float life = organicLife(member, time, mode);
  float change = 0.5 + 0.5 * sin(phase * 0.79 + member * 0.37);
  vec3 p;
  vec3 center = vec3(0.0);
  vec3 mergeCenter = vec3(0.0);
  vec3 angles = vec3(0.0);

  if (mode < 0.5) {
    // Viscera: a shoulder becomes a vaulted pocket, then swells into a new lobe.
    if (member < 3.0) {
      p = mix(organicMuscle(a, angle, layer, phase), organicVault(a, angle, layer, phase + 0.7), change);
      p *= vec3(0.93 - 0.07 * member, 0.91, 0.89);
      if (member < 0.5) {
        center = vec3(-0.24 - 0.19 * wave, -0.22 + 0.23 * cos(phase), -0.13 + 0.16 * sin(phase * 0.73));
        angles = vec3(0.47 * wave, 0.25 + 0.53 * cos(phase), -0.24);
      } else if (member < 1.5) {
        center = vec3(0.19 + 0.20 * cos(phase), 0.24 + 0.26 * wave, -0.18 + 0.16 * cos(phase * 0.67));
        angles = vec3(-0.43 + 0.65 * wave, -0.38, 0.66 + 0.44 * cos(phase));
      } else {
        center = vec3(0.29 - 0.24 * wave, -0.08 + 0.23 * cos(phase), 0.17 + 0.25 * sin(phase * 0.83));
        angles = vec3(0.60 + 0.54 * wave, 0.54, -0.61 + 0.36 * wave);
      }
    } else {
      p = mix(organicVault(a, angle, layer, phase), organicMuscle(a, angle, layer, phase - 0.8), change) * vec3(0.76, 0.80, 0.91);
      float bearing = (member - 3.0) * 2.12 + 0.31 + 0.35 * sin(phase * 0.63);
      center = vec3((0.25 + 0.25 * life) * cos(bearing), (0.27 + 0.26 * life) * sin(bearing), 0.13 + 0.19 * wave);
      angles = vec3(0.54 * sin(bearing) + 0.61 * wave, 0.42 * cos(bearing), bearing * 0.68 + 0.38 * wave);
    }
    float pair = floor(member * 0.5);
    mergeCenter = vec3(0.21 * sin(pair * 2.1), 0.17 * cos(pair * 2.1), -0.06);
  } else if (mode < 1.5) {
    // Chitin: oblique armor lobes grow from a shared irregular muscular spine.
    if (member < 5.0) {
      p = mix(organicVault(a, angle, layer, phase), organicMuscle(a, angle, layer, phase + 0.9), change * 0.85);
      p *= vec3(0.62 + 0.055 * cos(member), 0.70, 1.02);
      float side = mod(member, 2.0) < 0.5 ? -1.0 : 1.0;
      center = vec3((-0.51 + 0.25 * member) * (0.88 + 0.30 * sin((time - 7.0) * 0.61)), side * (0.16 + 0.32 * life), 0.21 * cos(member * 1.7 + phase * 0.64));
      angles = vec3(side * 0.54 + 0.63 * wave, 0.44 + 0.44 * cos(phase * 0.8), side * (0.53 + 0.46 * wave));
    } else {
      float side = member < 5.5 ? -1.0 : 1.0;
      p = organicMuscle(a, angle, layer, phase) * vec3(1.04, 0.47 + 0.18 * change, 0.64);
      center = vec3(0.10 * wave, side * 0.15, -0.24 + 0.18 * cos(phase));
      angles = vec3(side * 0.26 + 0.50 * wave, 0.30 * cos(phase), side * 0.18);
    }
    mergeCenter = vec3(member < 5.0 ? (member - 2.0) * 0.12 : 0.0, 0.0, -0.15);
  } else if (mode < 2.5) {
    // Aeolian: thick neighboring wavefronts shear around traveling crests.
    p = organicWindfront(a, angle, layer, phase * 0.84, member);
    float band = member - 2.0;
    center = vec3(0.17 * sin(member * 1.9 + phase * 0.63), band * (0.10 + 0.24 * life), 0.25 * cos(member * 1.35 + phase * 0.7));
    angles = vec3(band * 0.13 + 0.59 * wave, 0.41 * sin(phase * 0.7), band * 0.12 + 0.33 * cos(phase));
    p *= vec3(0.86 + 0.22 * sin(phase * 0.72), 0.89, 0.93);
    p.yz = rotate(p.yz, 0.39 * a * sin(phase));
    mergeCenter = vec3(0.0, band * 0.07, 0.02);
  } else if (mode < 3.5) {
    // Meissner: nested flux contours reshape one broad multipolar envelope.
    float sharedPhase = (time - 7.0) * 0.79;
    p = organicFlux(a, angle, layer, sharedPhase + 0.16 * member, member);
    p.x *= (0.91 + 0.022 * member) * (0.89 + 0.20 * sin(sharedPhase * 0.73));
    angles = vec3(0.38 * sin(sharedPhase + member * 0.22), 0.32 * sin(sharedPhase * 0.8), 0.28 * cos(sharedPhase * 0.7));
    center = vec3(0.10 * sin(sharedPhase + member * 0.8), 0.11 * sin(member + sharedPhase), 0.13 * cos(member * 0.8 + sharedPhase));
  } else {
    // Heterodyne: two crossing families of three substantial ridged cells.
    // A common phase within each family keeps its crests locally organized.
    float family = floor(member / 3.0);
    float side = family < 0.5 ? -1.0 : 1.0;
    float lane = mod(member, 3.0) - 1.0;
    float familyPhase = (time - 7.0) * 0.82 + family * 1.2;
    float crossing = side * (0.62 + 0.46 * sin(familyPhase * 0.77));
    p = organicInterference(a, angle, layer, familyPhase, member);
    p.y += lane * (0.17 + 0.32 * life);
    p.xy = rotate(p.xy, crossing);
    center = vec3(side * (0.05 + 0.18 * life), 0.08 * wave, side * 0.18 * sin(familyPhase * 0.67));
    angles = vec3(side * 0.29 + 0.39 * sin(familyPhase), side * 0.25 + 0.31 * cos(familyPhase * 0.81), 0.0);
    p *= vec3(0.91, 0.91, 0.94);
    mergeCenter = vec3(0.0, 0.0, side * 0.025);
  }

  // Changing proportions and converging centers make fading regions merge
  // into adjacent anatomy instead of blinking out at a fixed destination.
  p *= vec3(0.95 + 0.30 * sin(phase * 0.74 + 0.4), 0.96 - 0.32 * sin(phase * 0.74 + 0.4), 0.94 + 0.30 * cos(phase * 0.83 - 0.3));
  p *= 0.76 + 0.30 * life;
  center = mix(mergeCenter, center, 0.30 + 0.70 * life);
  p = organicTurn(p, angles) + center;
  float clock = (time - 7.0) * 0.67;
  p.y += 0.15 * sin(2.8 * p.x + 1.2 * p.z - clock);
  p.z += 0.17 * sin(2.4 * p.x - 1.3 * p.y + clock * 0.83);
  p.x += 0.08 * sin(2.0 * p.y + 1.7 * p.z - clock * 0.71);
  // Soft compression controls framing without flat clamped silhouettes.
  return 0.94 * p / sqrt(vec3(1.0) + 0.20 * p * p);
}

// Crystalline sections use exact support planes, including edge samples.
// Membership stays fixed while proportions and connected frames evolve.
vec3 polyDirection(float axial, float angle) {
  float x = clamp(axial, -0.99995, 0.99995);
  float radius = sqrt(max(0.00001, 1.0 - x * x));
  return vec3(x, radius * cos(angle), radius * sin(angle));
}

float polyBoxRadius(vec3 direction, vec3 halfExtent) {
  vec3 support = abs(direction) / halfExtent;
  return 1.0 / max(max(support.x, support.y), support.z);
}

float polyTetraRadius(vec3 direction, vec4 support) {
  float a = dot(direction, vec3(1.0, 1.0, 1.0)) / support.x;
  float b = dot(direction, vec3(-1.0, -1.0, 1.0)) / support.y;
  float c = dot(direction, vec3(-1.0, 1.0, -1.0)) / support.z;
  float d = dot(direction, vec3(1.0, -1.0, -1.0)) / support.w;
  return 1.0 / max(max(a, b), max(c, d));
}

vec4 polyBoxPlane(int index, vec3 extent) {
  if (index == 0) return vec4(-1.0, 0.0, 0.0, extent.x);
  if (index == 1) return vec4(1.0, 0.0, 0.0, extent.x);
  if (index == 2) return vec4(0.0, -1.0, 0.0, extent.y);
  if (index == 3) return vec4(0.0, 1.0, 0.0, extent.y);
  if (index == 4) return vec4(0.0, 0.0, -1.0, extent.z);
  return vec4(0.0, 0.0, 1.0, extent.z);
}

// Every plane uses dot(normal, point) <= support. Unused slots have no normal.
// Family 0: cut box; 1: hexagonal prism; 2: clipped tetrahedron; 3: rhombic body.
vec4 polySupportPlane(float family, int index, vec3 extent, vec4 parameters) {
  if (family < 0.5) {
    if (index < 6) return polyBoxPlane(index, extent);
    if (index >= 14) return vec4(0.0);
    float member = float(index - 6);
    vec3 normal = vec3(mod(member, 2.0), mod(floor(member / 2.0), 2.0), floor(member / 4.0)) * 2.0 - 1.0;
    normal.xz = rotate(normal.xz, -parameters.w);
    return vec4(normal, parameters.x);
  }
  if (family < 1.5) {
    if (index < 6) {
      float bearing = float(index) * PI / 3.0;
      return vec4(cos(bearing), 0.0, sin(bearing), extent.x);
    }
    if (index == 6) return vec4(0.0, -1.0, 0.0, extent.y);
    if (index == 7) return vec4(0.0, 1.0, 0.0, extent.y);
    return vec4(0.0);
  }
  if (family < 2.5) {
    if (index == 0) return vec4(1.0, 1.0, 1.0, parameters.x);
    if (index == 1) return vec4(-1.0, -1.0, 1.0, parameters.y);
    if (index == 2) return vec4(-1.0, 1.0, -1.0, parameters.z);
    if (index == 3) return vec4(1.0, -1.0, -1.0, parameters.w);
    if (index < 10) return polyBoxPlane(index - 4, extent);
    return vec4(0.0);
  }
  if (family > 3.5) {
    float bearing = mod(float(index), 6.0) * PI / 3.0;
    vec3 normal = vec3(cos(bearing), 0.0, sin(bearing));
    if (index < 6) return vec4(normal, extent.x);
    float slope = extent.x / (extent.y - parameters.x);
    normal.y = index < 12 ? slope : -slope;
    return vec4(normal, slope * extent.y);
  }
  if (index < 12) {
    float member = mod(float(index), 4.0);
    vec2 signs = vec2(mod(member, 2.0), floor(member / 2.0)) * 2.0 - 1.0;
    if (index < 4) return vec4(signs, 0.0, parameters.x);
    if (index < 8) return vec4(0.0, signs, parameters.y);
    return vec4(signs.y, 0.0, signs.x, parameters.z);
  }
  return polyBoxPlane(index - 12, extent);
}

vec3 polyNearestEdge(vec3 point, float family, vec3 extent, vec4 parameters) {
  vec4 face = vec4(0.0);
  float nearest = 100000.0;
  for (int index = 0; index < 18; index++) {
    vec4 plane = polySupportPlane(family, index, extent, parameters);
    float normalLength = length(plane.xyz);
    if (normalLength > 0.001) {
      plane /= normalLength;
      float distanceToFace = abs(plane.w - dot(plane.xyz, point));
      if (distanceToFace < nearest) {
        nearest = distanceToFace;
        face = plane;
      }
    }
  }
  point += face.xyz * (face.w - dot(face.xyz, point));
  vec3 edgePoint = point;
  nearest = 100000.0;
  float runnerUp = 100000.0;
  for (int index = 0; index < 18; index++) {
    vec4 plane = polySupportPlane(family, index, extent, parameters);
    float normalLength = length(plane.xyz);
    if (normalLength > 0.001) {
      plane /= normalLength;
      vec3 tangent = plane.xyz - face.xyz * dot(face.xyz, plane.xyz);
      float tangentLength = length(tangent);
      if (tangentLength > 0.001) {
        float distanceToEdge = max(0.0, plane.w - dot(plane.xyz, point)) / tangentLength;
        if (distanceToEdge < nearest) {
          runnerUp = nearest;
          nearest = distanceToEdge;
          edgePoint = point + tangent * (distanceToEdge / tangentLength);
        } else if (distanceToEdge < runnerUp) {
          runnerUp = distanceToEdge;
        }
      }
    }
  }
  // From a point on a convex face, its nearest bounding line lies on the valid
  // face polygon. Choosing that line cannot cross an earlier support plane.
  // Let attraction return to the continuous skin when two edges compete.
  // Switching the winning edge then has no discontinuous position jump.
  float tieWidth = 0.14 * max(extent.x, max(extent.y, extent.z));
  float attraction = smoothstep(0.0, tieWidth, runnerUp - nearest);
  return mix(point, edgePoint, attraction);
}

vec3 polyPrimitive(vec3 direction, float layer, float family, vec3 extent, vec4 parameters) {
  float radius;
  if (family < 0.5) {
    vec3 cutDirection = direction;
    cutDirection.xz = rotate(cutDirection.xz, parameters.w);
    radius = min(polyBoxRadius(direction, extent), parameters.x / dot(abs(cutDirection), vec3(1.0)));
  } else if (family < 1.5) {
    float localAngle = atan(direction.z, direction.x);
    float sector = mod(localAngle + PI / 6.0, PI / 3.0) - PI / 6.0;
    float side = length(direction.xz) * cos(sector) / extent.x;
    radius = 1.0 / max(side, abs(direction.y) / extent.y);
  } else if (family < 2.5) {
    radius = min(polyTetraRadius(direction, parameters), polyBoxRadius(direction, extent));
  } else if (family < 3.5) {
    vec3 absolute = abs(direction);
    float support = max((absolute.x + absolute.y) / parameters.x,
                        max((absolute.y + absolute.z) / parameters.y,
                            (absolute.z + absolute.x) / parameters.z));
    radius = min(1.0 / support, polyBoxRadius(direction, extent));
  } else {
    float bearing = atan(direction.z, direction.x);
    float sector = mod(bearing + PI / 6.0, PI / 3.0) - PI / 6.0;
    float side = length(direction.xz) * cos(sector);
    float slope = extent.x / (extent.y - parameters.x);
    radius = 1.0 / max(side / extent.x,
                        (side + slope * abs(direction.y)) / (slope * extent.y));
  }
  vec3 point = direction * radius;
  if (layer > 1.5) return polyNearestEdge(point, family, extent, parameters);
  return point * layer;
}

vec3 polySectionPose(vec3 point, vec3 center, vec3 angles) {
  point.xy = rotate(point.xy, angles.z);
  point.xz = rotate(point.xz, angles.y);
  point.yz = rotate(point.yz, angles.x);
  return center + point;
}

float polyMemberCount(float mode) {
  if (mode < 0.5) return 16.0;
  if (mode < 1.5) return 15.0;
  if (mode < 2.5) return 16.0;
  if (mode < 3.5) return 15.0;
  return 12.0;
}

float polyhedralOrder(float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  // Coherence stays high enough for moving facets to read. Presence, below,
  // controls gradual turnover independently of the particle flow field.
  return 0.90 + 0.07 * sin((time - 7.0) * 0.57 + member * 1.71)
              + 0.03 * sin((time - 7.0) * 0.37 + member * 2.39 + mode * 0.8);
}

float polyPresenceMember(float member, float time, float mode) {
  float phase = (time - 7.0) * (0.96 + 0.045 * mod(member, 3.0) + 0.028 * mode);
  phase += member * 2.399963 + mode * 0.71;
  phase += 0.24 * sin((time - 7.0) * 0.43 + member * 0.83);
  // A broad sinusoid has no timed gates or identity changes. Geometry draws
  // the receding section into its parent or central mass during the same wave.
  return 0.15 + 0.85 * (0.5 + 0.5 * sin(phase));
}

float polyhedralPresence(float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  return polyPresenceMember(member, time, mode);
}

vec3 polyTetraVertex(float index) {
  if (index < 0.5) return vec3(1.0, 1.0, 1.0) * 0.577350269;
  if (index < 1.5) return vec3(-1.0, -1.0, 1.0) * 0.577350269;
  if (index < 2.5) return vec3(-1.0, 1.0, -1.0) * 0.577350269;
  return vec3(1.0, -1.0, -1.0) * 0.577350269;
}

vec3 polyAlongAxis(vec3 point, vec3 axis) {
  axis = normalize(axis);
  // These construction axes stay away from the Z pole.
  vec3 tangent = normalize(vec3(-axis.y, axis.x, 0.0));
  return tangent * point.x + axis * point.y + cross(tangent, axis) * point.z;
}

vec3 polyIcosaAxis(float member) {
  float local = mod(member, 4.0);
  float a = mod(local, 2.0) * 2.0 - 1.0;
  float b = floor(local / 2.0) * 2.0 - 1.0;
  if (member < 4.0) return normalize(vec3(0.0, a, b * 1.618033989));
  if (member < 8.0) return normalize(vec3(a, b * 1.618033989, 0.0));
  return normalize(vec3(b * 1.618033989, 0.0, a));
}

vec3 polyhedralVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  float phase = time - 7.0;
  float local = member * 1.927;
  float presence = polyPresenceMember(member, time, mode);
  float growth = 0.56 + 0.44 * presence;
  vec3 direction = polyDirection(axial, angle);

  if (mode < 0.5) {
    // Tetrarch changes its recursive anatomy: chambers sink into their parent,
    // tips trade length, and the four parent arms open at different rhythms.
    float parent = floor(member / 4.0);
    float child = mod(member, 4.0);
    float parentPhase = parent * 1.73;
    vec3 parentAngles = vec3(0.52 * sin(phase * 0.52 + parentPhase),
                             0.59 * sin(phase * 0.43 + parentPhase + 0.8),
                             0.46 * cos(phase * 0.61 + parentPhase));
    vec3 parentCenter = polyTetraVertex(parent) * (0.38 + 0.18 * sin(phase * 0.64 + parentPhase));
    parentCenter *= vec3(0.94 + 0.32 * sin(phase * 0.56),
                         0.92 + 0.34 * cos(phase * 0.47),
                         0.95 + 0.28 * sin(phase * 0.51 + 1.0));
    vec3 childCenter = polyTetraVertex(child) * (0.065 + 0.29 * presence);
    childCenter *= 0.92 + 0.22 * cos(phase * 0.71 + parentPhase);
    vec4 support = vec4(0.32 + 0.13 * sin(phase * 0.78 + local),
                        0.34 + 0.13 * cos(phase * 0.61 + local),
                        0.34 + 0.12 * sin(phase * 0.72 + local + 1.0),
                        0.31 + 0.11 * cos(phase * 0.57 + local + 2.0)) * growth;
    vec3 extent = (vec3(0.40, 0.43, 0.39)
                    + vec3(0.16, 0.17, 0.14) * sin(vec3(0.63, 0.76, 0.59) * phase + local)) * growth;
    vec3 point = polyPrimitive(direction, layer, 2.0, extent, support);
    point = polySectionPose(point, childCenter,
                            vec3(0.29 * sin(phase * 0.73 + local),
                                 0.32 * cos(phase * 0.62 + local),
                                 0.27 * sin(phase * 0.68 + local)));
    return polySectionPose(point, parentCenter, parentAngles) * 0.97;
  }

  if (mode < 1.5) {
    // Every branch inherits the actual changing length and frame of its
    // ancestors. Receding tips shorten and fold back into that living junction.
    float depth = member < 1.0 ? 0.0 : member < 3.0 ? 1.0 : member < 7.0 ? 2.0 : 3.0;
    float path = member - (pow(2.0, depth) - 1.0);
    vec3 start = vec3(-0.65, -0.14, -0.04);
    vec3 axis = normalize(vec3(0.88, 0.31 + 0.18 * sin(phase * 0.58), 0.13));
    float segmentLength = 0.68 + 0.14 * sin(phase * 0.61);
    float node = 0.0;
    for (int level = 0; level < 3; level++) {
      if (float(level) < depth) {
        start += axis * segmentLength * 0.75;
        float bit = mod(floor(path / pow(2.0, depth - float(level) - 1.0)), 2.0);
        float side = bit * 2.0 - 1.0;
        node = node * 2.0 + 1.0 + bit;
        float nodePhase = node * 1.47 + float(level) * 0.83;
        float nodePresence = polyPresenceMember(node, time, mode);
        float opening = 0.30 + 0.70 * nodePresence;
        axis.xy = rotate(axis.xy, side * (0.70 + 0.36 * sin(phase * 0.63 + nodePhase)) * opening);
        axis.xz = rotate(axis.xz, side * (0.44 + 0.27 * cos(phase * 0.54 + nodePhase)) * opening);
        segmentLength = 0.04 + segmentLength * (0.57 + 0.10 * sin(phase * 0.69 + nodePhase))
                          * (0.78 + 0.22 * nodePresence);
      }
    }
    float width = segmentLength * (0.30 + 0.105 * sin(phase * 0.74 + local)) + 0.035;
    float halfLength = segmentLength * (0.63 + 0.17 * cos(phase * 0.66 + local));
    float shoulder = halfLength * (0.48 + 0.24 * sin(phase * 0.71 + local));
    vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, halfLength, width),
                                vec4(shoulder, 0.0, 0.0, 0.0));
    return (start + axis * segmentLength * 0.43 + polyAlongAxis(point, axis)) * 1.06;
  }

  if (mode < 2.5) {
    // Compression changes the 4D cells themselves, not only their projection.
    // Corner planes turn broad cells into wedges as their nesting depths trade.
    float cell = mod(member, 8.0);
    float nested = floor(member / 8.0);
    float fixedAxis = floor(cell / 2.0);
    float side = mod(cell, 2.0) * 2.0 - 1.0;
    float cellPhase = cell * 1.31;
    vec3 extent = (vec3(0.42, 0.40, 0.43)
                    + vec3(0.15, 0.14, 0.16) * sin(vec3(0.58, 0.73, 0.65) * phase + cellPhase))
                  * (0.72 + 0.28 * presence);
    float cut = dot(extent, vec3(1.0)) * (0.69 + 0.20 * sin(phase * 0.68 + cellPhase));
    vec3 point = polyPrimitive(direction, layer, 0.0, extent, vec4(cut, 0.0, 0.0, 0.0));
    float fixedCoordinate = side * (0.16 + 0.32 * presence) * (1.0 + 0.15 * cos(phase * 0.62 + cellPhase));
    vec4 space;
    if (fixedAxis < 0.5) space = vec4(fixedCoordinate, point.x, point.y, point.z);
    else if (fixedAxis < 1.5) space = vec4(point.x, fixedCoordinate, point.y, point.z);
    else if (fixedAxis < 2.5) space = vec4(point.x, point.y, fixedCoordinate, point.z);
    else space = vec4(point, fixedCoordinate);
    space.xw = rotate(space.xw, 0.48 + 0.75 * sin(phase * 0.56) + nested * 0.54);
    space.zw = rotate(space.zw, 0.36 + 0.68 * sin(phase * 0.67 + 0.7) - nested * 0.46);
    space.yw = rotate(space.yw, 0.62 * sin(phase * 0.48 + 1.0));
    space.yz = rotate(space.yz, 0.25 * sin(phase * 0.41));
    float nestingScale = nested < 0.5 ? 0.91 : 0.61 + 0.23 * sin(phase * 0.61 + cellPhase * 0.19);
    return space.xyz * (1.82 / (1.82 - space.w)) * nestingScale;
  }

  if (mode < 3.5) {
    // The crown alternates broad shoulders and long crystal spires. Smaller
    // growths merge down into the changing parent shoulder during their fade.
    float parent = floor(member / 3.0);
    float tier = mod(member, 3.0);
    float bearing = parent * 2.0 * PI / 5.0;
    float parentPhase = parent * 1.69;
    float parentPresence = polyPresenceMember(parent * 3.0, time, mode);
    float spread = 0.56 + 0.29 * sin(phase * 0.59 + parentPhase * 0.31);
    vec3 axis = normalize(vec3(spread * cos(bearing), 0.82, spread * sin(bearing)));
    axis.xy = rotate(axis.xy, 0.35 * sin(phase * 0.62 + parentPhase));
    axis.yz = rotate(axis.yz, 0.39 * cos(phase * 0.53 + parentPhase));
    float radius = (0.28 + 0.12 * sin(phase * 0.64 + parentPhase)) * (0.60 + 0.40 * parentPresence);
    vec3 center = vec3(radius * cos(bearing), -0.25 + 0.14 * sin(phase * 0.68 + parentPhase), radius * sin(bearing));
    float width = 0.22 + 0.075 * sin(phase * 0.73 + parentPhase);
    float height = (0.51 + 0.22 * cos(phase * 0.62 + parentPhase)) * (0.70 + 0.30 * parentPresence);
    if (tier > 0.5) {
      float side = tier * 2.0 - 3.0;
      float shoulderDistance = 0.05 + 0.24 * presence;
      vec3 shoulder = vec3(shoulderDistance * cos(bearing + side * 0.77), 0.0,
                           shoulderDistance * sin(bearing + side * 0.77));
      center += axis * height * (0.13 + 0.58 * presence) + shoulder;
      axis.xy = rotate(axis.xy, side * (0.43 + 0.29 * sin(phase * 0.61 + parentPhase)) * (0.30 + 0.70 * presence));
      axis.xz = rotate(axis.xz, side * (0.36 + 0.26 * cos(phase * 0.53 + local)));
      width = (0.145 + 0.045 * sin(phase * 0.77 + local)) * growth;
      height = (0.32 + 0.14 * cos(phase * 0.66 + local)) * growth;
    }
    float shoulder = height * (0.49 + 0.25 * sin(phase * 0.65 + local));
    vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, height, width),
                                vec4(shoulder, 0.0, 0.0, 0.0));
    point.xz = rotate(point.xz, 0.29 * sin(phase * 0.55 + local));
    return center + polyAlongAxis(point, axis);
  }

  // Rhombic axes alternately become long blades or squat, broad chambers.
  // Receding axes move inward and fuse with the central faceted envelope.
  vec3 axis = polyIcosaAxis(member);
  axis.xy = rotate(axis.xy, 0.33 * sin(phase * 0.57 + local));
  axis.yz = rotate(axis.yz, 0.39 * cos(phase * 0.49 + local));
  float radial = (0.30 + 0.13 * sin(phase * 0.67 + local)) * (0.35 + 0.65 * presence);
  float lengthScale = (0.45 + 0.21 * cos(phase * 0.61 + local)) * growth;
  float width = (0.235 + 0.075 * sin(phase * 0.71 + local)) * growth;
  vec3 extent = vec3(width, lengthScale, width * (1.05 + 0.22 * cos(phase * 0.64 + local)));
  vec3 spans = vec3(lengthScale * (0.78 + 0.15 * sin(phase * 0.54 + local)) + width * 0.68,
                    lengthScale * (0.79 + 0.17 * cos(phase * 0.63 + local)) + width * 0.67,
                    width * (1.36 + 0.24 * sin(phase * 0.58 + local)));
  vec3 point = polyPrimitive(direction, layer, 3.0, extent, vec4(spans, 0.0));
  point.xz = rotate(point.xz, member * 0.618 + 0.27 * sin(phase * 0.63 + local));
  vec3 result = axis * radial + polyAlongAxis(point, axis);
  return result * vec3(0.94 + 0.26 * sin(phase * 0.57),
                       0.91 + 0.29 * cos(phase * 0.64),
                       0.96 + 0.23 * sin(phase * 0.53 + 1.0));
}

`;
