export const volumeShapes = `
// Stable surface identities deform continuously inside a shared spatial field.
float organicMember(float part, float mode) {
  float count = mode < 0.5 ? 6.0 : mode < 1.5 ? 7.0 : mode < 2.5 ? 5.0 : 6.0;
  return min(count - 1.0, floor(part * count));
}

float organicOrder(float part, float time, float mode) {
  float region = part * (4.7 + 0.31 * mode);
  return 0.84 + 0.10 * sin(time * 0.38 - region)
    + 0.055 * sin(time * 0.23 + 1.7 * region + mode);
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

// Two muscular shoulders with a migrating cleft and unequal transverse ridges.
vec3 organicMuscle(float a, float angle, float layer, float phase) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float cleft = a - 0.13 * sin(phase * 0.73);
  float radius = cap * (0.56 - 0.19 * exp(-8.0 * cleft * cleft));
  radius *= 1.0 + 0.17 * cos(3.0 * angle + 1.6 * a - phase)
    + 0.06 * cos(5.0 * angle - 2.0 * a + phase * 0.69);
  vec3 p = vec3(0.89 * a, radius * cos(angle) * layer, radius * sin(angle) * layer);
  p.y += cap * (0.17 * sin(2.5 * a - phase) + 0.07 * sin(4.0 * a + phase * 0.6));
  p.z += cap * 0.20 * cos(2.8 * a + phase * 0.8);
  return p;
}

// A thick vaulted skin with a real invaginated pocket, not a mesh cut-out.
vec3 organicVault(float a, float angle, float layer, float phase) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float y = cap * cos(angle) * (0.72 + 0.11 * sin(2.0 * a + phase));
  float z = cap * sin(angle) * (0.36 + 0.08 * cos(2.7 * a - phase));
  float front = max(0.0, sin(angle));
  float pocketX = a - 0.18 * sin(phase * 0.8);
  float pocket = exp(-4.5 * pocketX * pocketX - 5.5 * y * y);
  z -= (0.40 + 0.08 * cos(phase)) * pocket * front * front;
  z += 0.22 * (a * a - 0.55 * y * y) + 0.10 * cap * cos(4.2 * a + phase);
  return vec3(0.91 * a, y * layer, z * layer);
}

vec3 organicWindfront(float a, float angle, float layer, float phase, float member) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float cross = cap * cos(angle);
  float width = 0.41 + 0.10 * sin(2.4 * a - phase);
  float y = cross * width;
  float envelope = 0.19 + 0.045 * cos(3.8 * a + phase * 0.7);
  float z = cap * sin(angle) * envelope * layer;
  z += 0.30 * sin(3.1 * a + 1.8 * cross - phase)
    + 0.12 * sin(5.0 * a - 1.3 * cross + phase * 0.6);
  y += cap * 0.11 * sin(2.1 * a + phase * 0.77 + member);
  return vec3(1.06 * a + 0.07 * cap * sin(2.0 * angle - phase), y * layer, z);
}

vec3 organicFlux(float a, float angle, float layer, float phase, float shell) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float saddle = a - 0.16 * sin(phase * 0.71);
  float shoulder = 0.48 + 0.32 * (1.0 - exp(-5.0 * saddle * saddle));
  float pole = angle + 0.72 * sin(2.1 * a - phase * 0.7);
  float radius = cap * shoulder * (1.0 + 0.17 * cos(4.0 * pole + 2.0 * a + phase));
  vec3 p = vec3(1.10 * a, radius * cos(pole), 0.76 * radius * sin(pole));
  p.yz *= (0.68 + 0.085 * shell) * layer;
  p.y += 0.12 * cap * sin(3.0 * a - phase);
  p.z += 0.17 * cap * sin(2.2 * a + phase * 0.63);
  p.x += 0.12 * cap * cos(2.0 * pole - phase);
  return p;
}

vec3 organicInterference(float a, float angle, float layer, float phase, float member) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float lane = mod(member, 3.0) - 1.0;
  float crossSection = cap * organicSignedPower(cos(angle), 0.82);
  float crest = 3.8 * a + lane * 1.45 - phase;
  float width = 0.31 + 0.065 * cos(crest);
  float thickness = 0.22 + 0.04 * sin(crest + 0.8);
  vec3 p = vec3(1.04 * a, crossSection * width * layer, cap * sin(angle) * thickness * layer);
  // Traveling ridges are offset across neighboring lanes, so intersections
  // open into alternating troughs rather than six copies of a central lobe.
  p.z += 0.26 * sin(crest + 1.8 * crossSection)
    + 0.13 * sin(2.3 * a - 2.6 * crossSection + phase * 0.63);
  p.y += 0.07 * cap * sin(2.7 * a + phase * 0.71 + lane);
  return p;
}

vec3 organicVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float a = clamp(axial, -1.0, 1.0);
  float member = organicMember(part, mode);
  float phase = (time - 8.0) * 0.47 - member * 0.91;
  float wave = sin(phase);
  vec3 p;
  vec3 center = vec3(0.0);
  vec3 angles = vec3(0.0);

  if (mode < 0.5) {
    // Viscera: muscular shoulders surround three differently inclined pockets.
    if (member < 3.0) {
      p = organicMuscle(a, angle, layer, phase);
      p *= vec3(0.93 - 0.07 * member, 0.91, 0.89);
      if (member < 0.5) {
        center = vec3(-0.21, -0.26, -0.13);
        angles = vec3(0.34 * wave, 0.25 + 0.38 * cos(phase), -0.24);
      } else if (member < 1.5) {
        center = vec3(0.19, 0.24, -0.18);
        angles = vec3(-0.43 + 0.46 * wave, -0.38, 0.66 + 0.30 * cos(phase));
      } else {
        center = vec3(0.31, -0.10, 0.29);
        angles = vec3(0.60 + 0.36 * wave, 0.54, -0.61 + 0.22 * wave);
      }
    } else {
      p = organicVault(a, angle, layer, phase) * vec3(0.76, 0.80, 0.91);
      float bearing = (member - 3.0) * 2.12 + 0.31;
      center = vec3(0.30 * cos(bearing), 0.38 * sin(bearing), 0.15);
      angles = vec3(0.54 * sin(bearing) + 0.46 * wave, 0.42 * cos(bearing), bearing * 0.68 + 0.25 * wave);
    }
  } else if (mode < 1.5) {
    // Chitin: oblique armor lobes grow from a shared irregular muscular spine.
    if (member < 5.0) {
      p = organicVault(a, angle, layer, phase);
      p *= vec3(0.62 + 0.055 * cos(member), 0.70, 1.02);
      float side = mod(member, 2.0) < 0.5 ? -1.0 : 1.0;
      center = vec3(-0.51 + 0.25 * member, side * 0.21, 0.12 * cos(member * 1.7));
      angles = vec3(side * 0.54 + 0.42 * wave, 0.44 + 0.25 * cos(phase * 0.8), side * (0.53 + 0.26 * wave));
    } else {
      float side = member < 5.5 ? -1.0 : 1.0;
      p = organicMuscle(a, angle, layer, phase) * vec3(1.04, 0.47, 0.64);
      center = vec3(0.0, side * 0.15, -0.24);
      angles = vec3(side * 0.26 + 0.31 * wave, 0.16 * cos(phase), side * 0.18);
    }
  } else if (mode < 2.5) {
    // Aeolian: thick neighboring wavefronts shear around traveling crests.
    p = organicWindfront(a, angle, layer, phase * 0.84, member);
    float band = member - 2.0;
    center = vec3(0.06 * sin(member * 1.9), band * 0.22, 0.13 * cos(member * 1.35));
    angles = vec3(band * 0.13 + 0.34 * wave, 0.24 * sin(phase * 0.7), band * 0.12 + 0.15 * cos(phase));
    p *= vec3(0.99, 0.89, 0.93);
  } else if (mode < 3.5) {
    // Meissner: nested flux contours reshape one broad multipolar envelope.
    float sharedPhase = (time - 8.0) * 0.43;
    p = organicFlux(a, angle, layer, sharedPhase + 0.16 * member, member);
    p.x *= 0.91 + 0.022 * member;
    angles = vec3(0.21 * sin(sharedPhase + member * 0.22), 0.18 * sin(sharedPhase * 0.8), 0.17 * cos(sharedPhase * 0.7));
    center = vec3(0.0, 0.025 * sin(member + sharedPhase), 0.03 * cos(member * 0.8 + sharedPhase));
  } else {
    // Heterodyne: two crossing families of three substantial ridged cells.
    // A common phase within each family keeps its crests locally organized.
    float family = floor(member / 3.0);
    float side = family < 0.5 ? -1.0 : 1.0;
    float lane = mod(member, 3.0) - 1.0;
    float familyPhase = (time - 8.0) * 0.47 + family * 1.2;
    float crossing = side * (0.63 + 0.21 * sin(familyPhase * 0.77));
    p = organicInterference(a, angle, layer, familyPhase, member);
    p.y += lane * 0.39;
    p.xy = rotate(p.xy, crossing);
    center = vec3(side * 0.08, 0.0, side * 0.12);
    angles = vec3(side * 0.29 + 0.20 * sin(familyPhase), side * 0.25 + 0.16 * cos(familyPhase * 0.81), 0.0);
    p *= vec3(0.91, 0.91, 0.94);
  }

  // Growth never removes a compartment; nearby surfaces share the final warp.
  p *= vec3(0.94 + 0.07 * sin(phase * 0.71), 0.95 + 0.075 * cos(phase * 0.83), 0.95 + 0.08 * sin(phase * 0.64 + 0.6));
  center += vec3(0.035 * sin(phase * 0.73), 0.045 * wave, 0.045 * cos(phase * 0.83));
  p = organicTurn(p, angles) + center;
  float clock = (time - 8.0) * 0.41;
  p.y += 0.085 * sin(2.8 * p.x + 1.2 * p.z - clock);
  p.z += 0.09 * sin(2.4 * p.x - 1.3 * p.y + clock * 0.83);
  p.x += 0.05 * sin(2.0 * p.y + 1.7 * p.z - clock * 0.71);
  // Soft compression controls framing without flat clamped silhouettes.
  return 0.94 * p / sqrt(vec3(1.0) + 0.16 * p * p);
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
  // Both frequencies are slow and unthresholded. No section has a lifetime,
  // emission event, disappearance gate, or abrupt change in membership.
  return 0.825 + 0.11 * sin(time * (0.23 + 0.013 * mode) + member * 1.71)
               + 0.065 * sin(time * (0.137 + 0.009 * mode) + member * 2.39 + 0.8);
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
  float phase = time - 8.0;
  float local = member * 1.927;
  vec3 direction = polyDirection(axial, angle);

  if (mode < 0.5) {
    // Tetrarch: two coupled tetrahedral scales. Four substantial arms each
    // contain four smaller chambers, with inherited and local articulation.
    float parent = floor(member / 4.0);
    float child = mod(member, 4.0);
    float parentPhase = parent * 1.73;
    vec3 parentAngles = vec3(0.28 * sin(phase * 0.21 + parentPhase),
                             0.34 * sin(phase * 0.17 + parentPhase + 0.8),
                             0.23 * cos(phase * 0.25 + parentPhase));
    vec3 parentCenter = polyTetraVertex(parent) * (0.43 + 0.075 * sin(phase * 0.23 + parentPhase));
    vec3 childCenter = polyTetraVertex(child) * (0.28 + 0.065 * cos(phase * 0.19 + parentPhase));
    vec4 support = vec4(0.34 + 0.060 * sin(phase * 0.27 + local),
                        0.34 + 0.055 * cos(phase * 0.21 + local),
                        0.35 + 0.050 * sin(phase * 0.24 + local + 1.0),
                        0.33 + 0.045 * cos(phase * 0.18 + local + 2.0));
    vec3 extent = vec3(0.43, 0.45, 0.42) + 0.045 * sin(vec3(0.21, 0.24, 0.18) * phase + local);
    vec3 point = polyPrimitive(direction, layer, 2.0, extent, support);
    point = polySectionPose(point, childCenter,
                            vec3(0.13 * sin(phase * 0.26 + local),
                                 0.16 * cos(phase * 0.20 + local),
                                 0.14 * sin(phase * 0.23 + local)));
    return polySectionPose(point, parentCenter, parentAngles);
  }

  if (mode < 1.5) {
    // Dendrite: one connected binary mineral skeleton. Each child inherits its
    // ancestor frames, so forks bend together instead of independent beads.
    float depth = member < 1.0 ? 0.0 : member < 3.0 ? 1.0 : member < 7.0 ? 2.0 : 3.0;
    float path = member - (pow(2.0, depth) - 1.0);
    vec3 start = vec3(-0.77, -0.13, -0.04);
    vec3 axis = normalize(vec3(0.88, 0.31, 0.13));
    float segmentLength = 0.66 + 0.055 * sin(phase * 0.18);
    for (int level = 0; level < 3; level++) {
      if (float(level) < depth) {
        start += axis * segmentLength * 0.81;
        float bit = mod(floor(path / pow(2.0, depth - float(level) - 1.0)), 2.0);
        float side = bit * 2.0 - 1.0;
        float ancestor = floor(path / pow(2.0, depth - float(level) - 1.0));
        float nodePhase = ancestor * 1.47 + float(level) * 0.83;
        axis.xy = rotate(axis.xy, side * (0.61 + 0.15 * sin(phase * 0.19 + nodePhase)));
        axis.xz = rotate(axis.xz, side * (0.41 + 0.14 * cos(phase * 0.16 + nodePhase)));
        segmentLength *= 0.71 + 0.035 * sin(phase * 0.22 + nodePhase);
      }
    }
    float width = segmentLength * (0.30 + 0.045 * sin(phase * 0.24 + local)) + 0.032;
    float halfLength = segmentLength * (0.67 + 0.065 * cos(phase * 0.20 + local));
    vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, halfLength, width),
                                vec4(halfLength * (0.49 + 0.11 * sin(phase * 0.23 + local)), 0.0, 0.0, 0.0));
    return (start + axis * segmentLength * 0.47 + polyAlongAxis(point, axis)) * 1.06;
  }

  if (mode < 2.5) {
    // Hypercell: two scales of eight 4D boundary cells. Rotation through W
    // changes relative faces, junctions, and apparent nesting in 3D.
    float cell = mod(member, 8.0);
    float nested = floor(member / 8.0);
    float fixedAxis = floor(cell / 2.0);
    float side = mod(cell, 2.0) * 2.0 - 1.0;
    float cellPhase = cell * 1.31;
    float width = 0.43 + 0.035 * sin(phase * 0.18 + cellPhase);
    vec3 extent = vec3(width) + 0.025 * sin(vec3(0.17, 0.21, 0.24) * phase + cellPhase);
    float cut = dot(extent, vec3(1.0)) * (0.83 + 0.075 * sin(phase * 0.22 + cellPhase));
    vec3 point = polyPrimitive(direction, layer, 0.0, extent, vec4(cut, 0.0, 0.0, 0.0));
    float fixedCoordinate = side * (0.43 + 0.025 * cos(phase * 0.19 + cellPhase));
    vec4 space;
    if (fixedAxis < 0.5) space = vec4(fixedCoordinate, point.x, point.y, point.z);
    else if (fixedAxis < 1.5) space = vec4(point.x, fixedCoordinate, point.y, point.z);
    else if (fixedAxis < 2.5) space = vec4(point.x, point.y, fixedCoordinate, point.z);
    else space = vec4(point, fixedCoordinate);
    space.xw = rotate(space.xw, 0.48 + 0.39 * sin(phase * 0.19) + nested * 0.34);
    space.zw = rotate(space.zw, 0.36 + 0.34 * sin(phase * 0.23 + 0.7) - nested * 0.26);
    space.yw = rotate(space.yw, 0.29 * sin(phase * 0.16 + 1.0));
    space.yz = rotate(space.yz, 0.22 * sin(phase * 0.14));
    float nestingScale = nested < 0.5 ? 1.0 : 0.59 + 0.075 * sin(phase * 0.17);
    return space.xyz * (1.82 / (1.82 - space.w)) * nestingScale;
  }

  if (mode < 3.5) {
    // Coronet: five broad parent crystals carry paired smaller growths. The
    // shoulder-to-tip proportion changes while oblique daughter axes open.
    float parent = floor(member / 3.0);
    float tier = mod(member, 3.0);
    float bearing = parent * 2.0 * PI / 5.0;
    float parentPhase = parent * 1.69;
    vec3 axis = normalize(vec3(0.45 * cos(bearing), 0.82, 0.45 * sin(bearing)));
    axis.xy = rotate(axis.xy, 0.16 * sin(phase * 0.20 + parentPhase));
    axis.yz = rotate(axis.yz, 0.18 * cos(phase * 0.17 + parentPhase));
    vec3 center = vec3(0.29 * cos(bearing), -0.27 + 0.065 * sin(phase * 0.23 + parentPhase), 0.29 * sin(bearing));
    float width = 0.235 + 0.035 * sin(phase * 0.22 + parentPhase);
    float height = 0.56 + 0.105 * cos(phase * 0.18 + parentPhase);
    if (tier > 0.5) {
      float side = tier * 2.0 - 3.0;
      vec3 shoulder = vec3(0.20 * cos(bearing + side * 0.77), 0.0, 0.20 * sin(bearing + side * 0.77));
      center += axis * height * 0.57 + shoulder;
      axis.xy = rotate(axis.xy, side * (0.42 + 0.16 * sin(phase * 0.19 + parentPhase)));
      axis.xz = rotate(axis.xz, side * 0.48);
      width = 0.135 + 0.025 * sin(phase * 0.25 + local);
      height = 0.34 + 0.065 * cos(phase * 0.21 + local);
    }
    vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, height, width),
                                vec4(height * (0.57 + 0.13 * sin(phase * 0.20 + local)), 0.0, 0.0, 0.0));
    point.xz = rotate(point.xz, 0.15 * sin(phase * 0.17 + local));
    return center + polyAlongAxis(point, axis);
  }

  // Aperiodic: twelve oblique rhombic growth axes share a dense center. Their
  // noncommensurate proportions repeatedly open different angular recesses.
  vec3 axis = polyIcosaAxis(member);
  axis.xy = rotate(axis.xy, 0.17 * sin(phase * 0.19 + local));
  axis.yz = rotate(axis.yz, 0.21 * cos(phase * 0.16 + local));
  float radial = 0.33 + 0.055 * sin(phase * 0.23 + local);
  float lengthScale = 0.53 + 0.12 * cos(phase * 0.18 + local);
  float width = 0.24 + 0.045 * sin(phase * 0.21 + local);
  vec3 extent = vec3(width, lengthScale, width * 1.13);
  vec3 spans = vec3(lengthScale * 0.79 + width * 0.71,
                    lengthScale * 0.83 + width * 0.68,
                    width * (1.40 + 0.14 * sin(phase * 0.17 + local)));
  vec3 point = polyPrimitive(direction, layer, 3.0, extent, vec4(spans, 0.0));
  point.xz = rotate(point.xz, member * 0.618 + 0.13 * sin(phase * 0.21 + local));
  return axis * radial + polyAlongAxis(point, axis);
}

`;
