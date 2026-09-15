export const volumeShapes = `
// Each member is a locally coherent chamber, hood, or structural rib. Annular
// pairs share one anatomical identity, so both halves form and release together.
float organicMember(float part, float mode) {
  float count = mode < 0.5 ? 8.0 : mode < 1.5 ? 10.0 : mode < 2.5 ? 6.0 : mode < 3.5 ? 12.0 : 8.0;
  return min(count - 1.0, floor(part * count));
}

float organicSection(float part, float mode) {
  float member = organicMember(part, mode);
  float paired = mode < 0.5 ? 6.0 : mode < 1.5 ? 8.0 : mode < 2.5 ? 0.0 : mode < 3.5 ? 10.0 : 4.0;
  return member < paired ? floor(member * 0.5) : member - paired * 0.5;
}

float organicOrder(float part, float time, float mode) {
  float section = organicSection(part, mode);
  float cycle = 0.5 + 0.5 * cos(time * (0.47 + mode * 0.019) - section * 1.79 + mode * 0.64);
  return 1.0 - 0.78 * smoothstep(0.74, 0.98, cycle);
}

float organicOrientation(float part, float mode) {
  float member = organicMember(part, mode);
  float paired = mode < 0.5 ? 6.0 : mode < 1.5 ? 8.0 : mode < 2.5 ? 0.0 : mode < 3.5 ? 10.0 : 4.0;
  return member < paired && mod(member, 2.0) < 0.5 ? -1.0 : 1.0;
}

vec3 organicTurn(vec3 p, vec3 angles) {
  p.xy = rotate(p.xy, angles.z);
  p.xz = rotate(p.xz, angles.y);
  p.yz = rotate(p.yz, angles.x);
  return p;
}

vec3 organicChamber(float a, float angle, float layer, float member, float phase) {
  float side = mod(member, 2.0) < 0.5 ? -1.0 : 1.0;
  float around = side * acos(clamp(a, -1.0, 1.0));
  float major = 0.56 + 0.07 * sin(2.0 * around - phase) + 0.035 * cos(3.0 * around + 0.7 * phase);
  float minor = 0.175 + 0.040 * cos(3.0 * around + phase) + 0.026 * sin(around - 1.2 * phase);
  float bearing = angle + 0.5 * sin(around + 0.6 * phase);
  float ribs = 1.0 + 0.09 * cos(5.0 * bearing + 2.0 * around + phase);
  float radial = major + minor * ribs * cos(bearing) * layer;
  vec3 p = vec3(radial * cos(around), radial * sin(around), minor * 1.4 * sin(bearing) * layer);
  p.z += 0.16 * sin(2.0 * around + 0.8 * phase) + 0.06 * cos(3.0 * around - phase);
  p.y *= 1.0 + 0.17 * sin(phase);
  p.x += 0.05 * sin(2.0 * around - phase);
  return p;
}

vec3 organicHood(float a, float angle, float layer, float phase) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float y = cap * cos(angle) * (0.69 + 0.09 * sin(phase + 2.0 * a));
  float thickness = 0.24 + 0.07 * cos(2.3 * a - phase);
  float z = cap * sin(angle) * thickness * layer;
  float pocket = exp(-5.0 * (a + 0.19 * sin(phase)) * (a + 0.19 * sin(phase)) - 7.0 * y * y);
  z += (0.41 + 0.16 * cos(phase)) * (a * a - 0.65 * y * y) - 0.28 * pocket;
  z += 0.085 * cos(4.5 * a + phase) * cap * cap;
  return vec3(a * (0.92 + 0.08 * sin(phase)), y * layer, z);
}

vec3 organicRib(float a, float angle, float layer, float phase) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float radius = cap * (0.14 + 0.055 * cos(2.7 * a - phase));
  vec3 p = vec3(1.02 * a, radius * cos(angle) * layer, radius * sin(angle) * layer);
  p.y += 0.23 * sin(2.4 * a + 0.6 * phase);
  p.z += 0.22 * cos(2.0 * a - phase) - 0.1;
  return p;
}

vec3 organicLobe(float a, float angle, float layer, float phase) {
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float left = exp(-6.0 * (a + 0.48) * (a + 0.48));
  float right = exp(-7.0 * (a - 0.47) * (a - 0.47));
  float radius = cap * (0.25 + (0.24 + 0.08 * sin(phase)) * left + (0.31 - 0.09 * sin(phase)) * right);
  radius *= 0.88 + 0.12 * cos(3.0 * angle + 1.8 * a - phase);
  vec3 p = vec3(0.79 * a, radius * cos(angle) * layer, radius * sin(angle) * layer);
  p.y += 0.16 * cap * sin(2.8 * a - phase);
  p.z += 0.13 * cap * cos(3.1 * a + 0.7 * phase);
  return p;
}

vec3 organicVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float a = clamp(axial, -1.0, 1.0);
  float member = organicMember(part, mode);
  float section = organicSection(part, mode);
  float phase = (time - 8.0) * 0.51 - section * 1.23;
  float wave = sin(phase);
  float growth = 0.84 + 0.16 * cos(phase * 0.83 + 0.4);
  vec3 p;
  vec3 center;
  vec3 angles;

  if (mode < 0.5) {
    // Chimera: offset mouth-like chambers underneath two buckled muscular hoods.
    if (member < 6.0) {
      p = organicChamber(a, angle, layer, member, phase);
      if (section < 0.5) {
        p *= vec3(0.88, 1.08, 1.05);
        center = vec3(-0.34, -0.07, 0.08);
        angles = vec3(0.42 + 0.48 * wave, -0.42, -0.37 + 0.22 * cos(phase));
      } else if (section < 1.5) {
        p *= vec3(0.77, 0.94, 1.22);
        center = vec3(0.32, 0.24 + 0.1 * wave, -0.24);
        angles = vec3(-0.83 + 0.47 * wave, 0.39, 0.78 - 0.28 * wave);
      } else {
        p *= vec3(0.76, 0.74, 1.0);
        center = vec3(0.39, -0.38, 0.19 + 0.1 * wave);
        angles = vec3(0.81 + 0.34 * wave, -0.59, -0.64);
      }
    } else {
      p = organicHood(a, angle, layer, phase);
      if (member < 6.5) {
        p *= vec3(0.81, 0.76, 0.84);
        center = vec3(-0.29, 0.35, -0.23);
        angles = vec3(-0.54 + 0.38 * wave, 0.63 * wave, -0.37);
      } else {
        p *= vec3(0.71, 0.82, 0.91);
        center = vec3(0.25, -0.04, 0.30);
        angles = vec3(0.50 * wave, -0.66, 0.92 + 0.28 * wave);
      }
    }
  } else if (mode < 1.5) {
    // Branchiae: four deep gill chambers shift around two bowed structural ribs.
    if (member < 8.0) {
      p = organicChamber(a, angle, layer, member, phase) * vec3(0.71, 1.03 - 0.045 * section, 0.93);
      center = vec3(-0.57 + 0.37 * section, 0.12 * sin(section * 1.5), 0.10 * cos(section * 1.7));
      angles = vec3(0.37 + 0.21 * section + 0.43 * wave, 0.68 + 0.16 * cos(phase), 0.12 * sin(section * 2.0));
    } else {
      float side = member < 8.5 ? -1.0 : 1.0;
      p = organicRib(a, angle, layer, phase) * vec3(1.0, 1.15, 1.35);
      center = vec3(0.0, side * 0.29, -0.28);
      angles = vec3(side * (0.32 + 0.25 * wave), 0.13 * wave, side * 0.2);
    }
  } else if (mode < 2.5) {
    // Carapace: substantial saddle-shaped skins overlap with deep pockets.
    if (member < 4.0) {
      p = organicHood(a, angle, layer, phase);
      if (member < 0.5) {
        p *= vec3(0.92, 0.94, 1.1);
        center = vec3(-0.21, -0.12, -0.16);
        angles = vec3(0.26 + 0.4 * wave, 0.13, -0.34);
      } else if (member < 1.5) {
        p *= vec3(0.89, 0.83, 0.95);
        center = vec3(0.24, 0.21, 0.10);
        angles = vec3(-0.46 + 0.46 * wave, 0.73 + 0.25 * wave, 0.30);
      } else if (member < 2.5) {
        p *= vec3(0.72, 0.73, 1.13);
        center = vec3(-0.19, 0.38, -0.18);
        angles = vec3(0.58 + 0.33 * wave, -0.62, 0.78 - 0.2 * wave);
      } else {
        p *= vec3(0.64, 0.82, 1.0);
        center = vec3(0.38, -0.29, 0.15);
        angles = vec3(-0.72 + 0.42 * wave, 0.26, -0.62 + 0.3 * wave);
      }
    } else {
      float side = member < 4.5 ? -1.0 : 1.0;
      p = organicRib(a, angle, layer, phase) * vec3(0.89, 1.34, 1.34);
      center = vec3(0.0, side * 0.39, -0.10);
      angles = vec3(0.34 * wave, side * 0.32, side * 0.51);
    }
  } else if (mode < 3.5) {
    // Colony: a dense irregular network of communicating cavities and bridges.
    if (member < 10.0) {
      p = organicChamber(a, angle, layer, member, phase);
      p *= vec3(0.69 + 0.075 * sin(section * 2.1), 0.72 + 0.06 * cos(section), 0.95);
      if (section < 0.5) center = vec3(-0.43, -0.26, 0.03);
      else if (section < 1.5) center = vec3(0.12, -0.38, 0.25);
      else if (section < 2.5) center = vec3(0.46, 0.14, -0.04);
      else if (section < 3.5) center = vec3(-0.04, 0.42, -0.18);
      else center = vec3(-0.28, 0.07, -0.35);
      angles = vec3(0.78 * sin(section * 1.8) + 0.46 * wave,
        0.65 * cos(section * 1.4) + 0.28 * sin(phase * 0.7), 0.6 * section);
    } else {
      float side = member < 10.5 ? -1.0 : 1.0;
      p = organicHood(a, angle, layer, phase) * vec3(0.62, 0.71, 0.85);
      center = vec3(side * 0.13, side * 0.18, 0.22);
      angles = vec3(side * 0.67 + 0.38 * wave, side * 0.34, side * 0.91);
    }
  } else {
    // Primordium: cleft lobes emerge around two asymmetric internal openings.
    if (member < 4.0) {
      float side = section < 0.5 ? -1.0 : 1.0;
      p = organicChamber(a, angle, layer, member, phase) * vec3(0.85, 0.81, 1.04);
      center = vec3(side * 0.33, -side * 0.21, 0.12);
      angles = vec3(side * 0.65 + 0.46 * wave, -side * 0.36, side * 0.48);
    } else {
      float lobe = member - 4.0;
      p = organicLobe(a, angle, layer, phase);
      p *= vec3(0.88 + 0.10 * cos(lobe), 0.84, 0.88 + 0.17 * wave);
      float bearing = lobe * 1.57 + 0.36;
      center = vec3(0.33 * cos(bearing), 0.41 * sin(bearing), -0.11 + 0.15 * sin(lobe * 2.0));
      angles = vec3(0.63 * sin(bearing) + 0.43 * wave,
        0.45 * cos(bearing) - 0.31 * wave, bearing + 0.24 * wave);
    }
  }

  // Local growth and displacement are staggered rather than a whole-body pulse.
  p *= vec3(growth, 0.91 + 0.13 * sin(phase + 0.8), 0.91 + 0.16 * cos(phase * 0.9));
  center += vec3(0.05 * sin(phase * 0.8), 0.065 * wave, 0.07 * cos(phase));
  return (organicTurn(p, angles) + center) * 0.88;
}

// Regional solids for a continuously changing assembly. Exact support planes
// supply skin and true edge samples before each section changes its own pose.
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
          nearest = distanceToEdge;
          edgePoint = point + tangent * (distanceToEdge / tangentLength);
        }
      }
    }
  }
  // From a point on a convex face, its nearest bounding line lies on the valid
  // face polygon. Choosing that line cannot cross an earlier support plane.
  return edgePoint;
}

float polyMemberCount(float mode) {
  if (mode < 0.5) return 7.0;
  if (mode < 1.5) return 6.0;
  if (mode < 2.5) return 9.0;
  return 8.0;
}

float polyhedralOrder(float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  float phase = time * (0.66 + 0.035 * mode) + member * 2.399963 + mode * 0.81;
  phase += 0.30 * sin(time * 0.29 + member * 0.83);
  // The low-order phase passes through different sections at different times.
  // Other sections remain coherent while another region comes apart.
  return 0.15 + 0.85 * smoothstep(-0.92, -0.32, sin(phase));
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
  } else {
    vec3 absolute = abs(direction);
    float support = max((absolute.x + absolute.y) / parameters.x,
                        max((absolute.y + absolute.z) / parameters.y,
                            (absolute.z + absolute.x) / parameters.z));
    radius = min(1.0 / support, polyBoxRadius(direction, extent));
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

vec3 polyhedralVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  float phase = (time - 8.0) * 0.67;
  float local = phase + member * 1.93;
  float order = polyhedralOrder(part, time, mode);
  float growth = 0.57 + 0.43 * order;
  vec3 direction = polyDirection(axial, angle);
  vec3 point;
  vec3 center;
  vec3 angles;

  if (mode < 0.5) {
    // Seven unequal blocks overlap along an oblique, changing spine. Shoulders
    // trade volume and tilt away while neighboring blocks develop new faces.
    float side = mod(member, 2.0) * 2.0 - 1.0;
    float station = (member - 3.0) / 3.0;
    center = vec3(0.59 * station,
                  0.23 * side + 0.17 * sin(local * 0.72),
                  0.24 * sin(member * 1.31) + 0.18 * cos(local * 0.68));
    center.x += 0.12 * sin(local * 0.83);
    center.y += 0.12 * station * sin(phase * 0.79);
    vec3 extent = vec3(0.31 + 0.10 * sin(local * 0.83),
                       0.36 + 0.11 * cos(local * 0.73),
                       0.34 + 0.10 * sin(local * 0.91 + 1.0)) * growth;
    float corner = dot(extent, vec3(1.0)) * (0.70 + 0.16 * sin(local * 0.69));
    point = polyPrimitive(direction, layer, 0.0, extent, vec4(corner, 0.0, 0.0, 0.13 * sin(local)));
    angles = vec3(0.36 * sin(local * 0.71),
                  side * 0.30 + 0.43 * cos(local * 0.66),
                  0.32 * sin(member * 1.07) + 0.41 * sin(local * 0.82));
  } else if (mode < 1.5) {
    // Six thick tetrahedral wedges continually change their junction. Their
    // vertices, clipping facets, and odd-angle poses evolve independently.
    float bearing = member * PI / 3.0;
    float distance = 0.35 + 0.13 * sin(local * 0.72);
    center = vec3(distance * cos(bearing + 0.24 * sin(local * 0.77)),
                  distance * sin(bearing + 0.20 * cos(local * 0.81)),
                  0.24 * cos(member * 2.11) + 0.19 * sin(local * 0.67));
    vec4 support = vec4(0.43 + 0.13 * sin(local),
                        0.44 + 0.12 * cos(local * 0.81),
                        0.46 + 0.12 * sin(local * 0.91 + 2.0),
                        0.42 + 0.10 * cos(local + 1.0)) * growth;
    vec3 extent = vec3(0.63 + 0.12 * sin(local * 0.74),
                       0.58 + 0.11 * cos(local * 0.83),
                       0.61 + 0.12 * sin(local * 0.69 + 1.0)) * growth;
    point = polyPrimitive(direction, layer, 2.0, extent, support);
    angles = vec3(member * 0.73 + 0.66 * sin(local * 0.69),
                  member * 1.19 + 0.62 * cos(local * 0.78),
                  bearing * 0.46 + 0.57 * sin(local * 0.89));
  } else if (mode < 2.5) {
    // Nine thick crystal chambers meet at different axes. The tilted caps grow
    // through the cluster, then contract as a different chamber takes over.
    float column = mod(member, 3.0) - 1.0;
    float row = floor(member / 3.0) - 1.0;
    center = vec3(0.43 * column + 0.13 * sin(local * 0.72),
                  0.40 * row + 0.16 * cos(local * 0.81),
                  0.25 * sin(member * 1.37) + 0.16 * sin(local * 0.64));
    float width = (0.23 + 0.08 * sin(local * 0.83)) * growth;
    float height = (0.40 + 0.18 * cos(local * 0.69)) * growth;
    point = polyPrimitive(direction, layer, 1.0, vec3(width, height, width), vec4(0.0));
    angles = vec3(0.47 * sin(member * 1.63) + 0.58 * sin(local * 0.75),
                  member * 0.49 + 0.36 * cos(local * 0.89),
                  0.52 * cos(member * 1.17) + 0.61 * sin(local * 0.68));
  } else if (mode < 3.5) {
    // Alternating blocks and triangular chambers make two oblique, interwoven
    // chains. Both chains change spacing, heading, and regional thickness.
    float chain = step(3.5, member);
    float station = mod(member, 4.0) - 1.5;
    float heading = chain < 0.5 ? 0.48 + 0.43 * sin(phase * 0.72) : -0.67 + 0.46 * cos(phase * 0.81);
    vec2 spine = rotate(vec2(station * 0.38, chain < 0.5 ? -0.14 : 0.17), heading);
    center = vec3(spine, (chain - 0.5) * 0.38 + 0.17 * sin(local * 0.71));
    center.xy += vec2(0.10 * sin(local * 0.93), 0.12 * cos(local * 0.84));
    if (mod(member, 2.0) < 0.5) {
      vec3 extent = vec3(0.35 + 0.12 * sin(local * 0.76),
                         0.28 + 0.09 * cos(local * 0.83),
                         0.33 + 0.10 * sin(local * 0.68 + 1.0)) * growth;
      float cut = dot(extent, vec3(1.0)) * (0.79 + 0.10 * cos(local * 0.81));
      point = polyPrimitive(direction, layer, 0.0, extent, vec4(cut, 0.0, 0.0, 0.0));
    } else {
      vec4 support = vec4(0.40 + 0.12 * sin(local),
                          0.42 + 0.10 * cos(local * 0.74),
                          0.40 + 0.11 * sin(local * 0.86 + 2.0),
                          0.41 + 0.10 * cos(local + 1.2)) * growth;
      point = polyPrimitive(direction, layer, 2.0, vec3(0.59, 0.54, 0.59) * growth, support);
    }
    angles = vec3((chain - 0.5) * 0.79 + 0.49 * cos(local * 0.73),
                  0.41 * sin(member * 1.47) + 0.62 * sin(local * 0.82),
                  heading + 0.57 * sin(local * 0.67));
  } else {
    // Eight oblique rhombic chambers surround a changing cleft. The opening
    // shifts and locally closes as neighboring sections grow into one another.
    float bearing = member * PI / 4.0;
    float radial = 0.48 + 0.15 * sin(local * 0.77);
    float opening = 0.73 + 0.25 * sin(phase * 0.74);
    center = vec3(radial * cos(bearing) * (1.08 + 0.12 * cos(phase)),
                  radial * sin(bearing) * opening,
                  0.26 * sin(2.0 * bearing + 0.29 * phase) + 0.15 * cos(local * 0.83));
    vec3 span = vec3(0.54 + 0.17 * sin(local * 0.79),
                    0.55 + 0.15 * cos(local * 0.88),
                    0.52 + 0.16 * sin(local * 0.71 + 1.2)) * growth;
    vec3 extent = vec3(0.43 + 0.11 * cos(local * 0.73),
                       0.44 + 0.12 * sin(local * 0.81),
                       0.45 + 0.11 * cos(local * 0.69 + 1.7)) * growth;
    point = polyPrimitive(direction, layer, 3.0, extent, vec4(span, 0.0));
    angles = vec3(0.47 * sin(member * 1.21) + 0.53 * sin(local * 0.74),
                  bearing * 0.41 + 0.62 * cos(local * 0.68),
                  bearing * 0.32 + 0.58 * sin(local * 0.87));
  }
  return polySectionPose(point, center, angles);
}

`;
