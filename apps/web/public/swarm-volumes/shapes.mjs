export const volumeShapes = `
// Closed organic volumes. Axial coordinates carry particles through the body;
// low spatial frequencies change its anatomy while preserving coherent rows.
float organicBell(float x, float center, float width) {
  float d = (x - center) / width;
  return exp(-d * d);
}

vec3 organicVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float a = clamp(axial, -1.0, 1.0);
  float cap = sqrt(max(0.0, 1.0 - a * a));
  float phase = (time - 8.0) * 0.62;
  float c = cos(angle);
  float s = sin(angle);
  vec3 p;

  if (mode < 0.5) {
    // Cumulus: one substantial body with broad lobes and migrating clefts.
    float meridian = angle + 0.55 * sin(1.8 * a - 0.8 * phase);
    float lobes = 0.16 * cos(3.0 * meridian + 0.7 * phase) * cap;
    float shoulder = 0.13 * sin(2.8 * a - 0.9 * phase);
    float radius = cap * (0.87 + lobes + shoulder);
    radius *= 0.91 + 0.09 * cos(2.0 * angle - 2.4 * a + phase);
    p = vec3(
      a * (1.02 + 0.12 * sin(0.8 * phase)) + 0.14 * cap * cap * s * sin(phase),
      radius * c * layer * (0.92 + 0.14 * cos(phase)),
      radius * s * layer * (0.96 + 0.18 * sin(phase + 1.0))
    );
    p.y += 0.17 * cap * cap * sin(2.1 * a + phase);
    p.z += 0.13 * cap * cap * cos(2.7 * a - 0.7 * phase);
  } else if (mode < 1.5) {
    // Confluence: connected bulky lobes exchange volume across thick necks.
    float left = organicBell(a, -0.56 + 0.09 * sin(phase), 0.29);
    float middle = organicBell(a, 0.02 + 0.13 * cos(0.8 * phase), 0.31);
    float right = organicBell(a, 0.59 + 0.06 * sin(phase + 1.4), 0.28);
    float radius = cap * (0.31 + (0.55 + 0.12 * sin(phase)) * left
      + (0.43 + 0.15 * cos(phase + 0.8)) * middle
      + (0.57 - 0.13 * sin(phase)) * right);
    float bearing = angle + 0.48 * sin(2.4 * a + 0.8 * phase);
    radius *= 0.94 + 0.06 * cos(3.0 * bearing - 0.6 * phase);
    p = vec3(
      1.24 * a,
      radius * cos(bearing) * layer * (0.89 + 0.12 * sin(2.2 * a - phase)),
      radius * sin(bearing) * layer * (0.94 + 0.13 * cos(2.5 * a + phase))
    );
    p.y += 0.24 * cap * sin(3.0 * a - 0.75 * phase);
    p.z += 0.24 * cap * cos(2.6 * a + 0.8 * phase);
  } else if (mode < 2.5) {
    // Aperture: two throughflow branches cover a closed, thick annular body.
    float branch = part < 0.5 ? -1.0 : 1.0;
    float around = branch * acos(a);
    float major = 0.74 + 0.09 * cos(2.0 * around - phase);
    float minor = 0.33 + 0.075 * sin(phase + 2.0 * around)
      + 0.035 * cos(3.0 * around - 0.7 * phase);
    float section = angle + 0.45 * sin(around + phase);
    float radial = major + minor * cos(section) * layer;
    p = vec3(
      radial * cos(around) * (1.03 + 0.13 * sin(phase)),
      radial * sin(around) * (0.98 - 0.15 * sin(phase)),
      minor * sin(section) * layer * 1.23
    );
    p.z += 0.21 * sin(2.0 * around + 0.85 * phase);
    p.y += 0.08 * cos(2.0 * around - phase);
    p.yz = rotate(p.yz, 0.34 + 0.24 * sin(0.7 * phase));
  } else if (mode < 3.5) {
    // Vesicles: overlapping thick cells form one porous, deep cellular mass.
    float cell = min(2.0, floor(part * 3.0));
    float branch = fract(part * 3.0) < 0.5 ? -1.0 : 1.0;
    float around = branch * acos(a);
    float beat = phase + cell * 2.05;
    float major = 0.48 + 0.055 * sin(beat + 2.0 * around);
    float minor = 0.255 + 0.055 * cos(beat - around);
    float radial = major + minor * c * layer;
    p = vec3(radial * cos(around), radial * sin(around), 1.15 * minor * s * layer);
    p.z += 0.085 * sin(2.0 * around + beat);
    if (cell < 0.5) {
      p.yz = rotate(p.yz, 0.18 + 0.42 * sin(phase));
      p += vec3(-0.33, -0.34 - 0.08 * sin(phase), 0.07);
    } else if (cell < 1.5) {
      p.yz = rotate(p.yz, 0.83 + 0.38 * cos(0.8 * phase));
      p.xz = rotate(p.xz, -0.2 + 0.28 * sin(phase));
      p += vec3(0.37, 0.07 + 0.10 * cos(phase), 0.15);
    } else {
      p.yz = rotate(p.yz, -0.76 + 0.34 * sin(phase + 1.0));
      p.xy = rotate(p.xy, 0.27 * cos(phase));
      p += vec3(-0.19 + 0.09 * sin(phase), 0.37, -0.21);
    }
  } else {
    // Sinew: three thick, intersecting muscular volumes form a compact braid.
    float strand = min(2.0, floor(part * 3.0));
    float bearing = strand * (2.0 * PI / 3.0) + 2.3 * a
      + 0.8 * sin(phase + 1.7 * a);
    float spread = cap * (0.30 + 0.095 * sin(2.3 * a - 0.8 * phase));
    float radius = cap * (0.37 + 0.055 * cos(2.8 * a + phase + strand));
    float section = angle + 0.3 * sin(2.0 * a + phase);
    p = vec3(
      1.2 * a + 0.055 * cap * cos(section) * sin(bearing),
      spread * cos(bearing) + radius * cos(section) * layer,
      spread * sin(bearing) + radius * sin(section) * layer
    );
    p.y += 0.20 * cap * sin(2.0 * a - phase);
    p.z += 0.16 * cap * cos(2.7 * a + 0.8 * phase);
    p.yz = rotate(p.yz, 0.24 * sin(0.7 * phase));
  }
  return p;
}

// Closed convex bodies and overlapping solids. Axial material coordinates travel
// through each body; temporal support changes alter the actual faces and edges.
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

vec3 polyhedralVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float phase = (time - 8.0) * 0.68;
  vec3 direction = polyDirection(axial, angle);
  bool edgeSample = layer > 1.5;
  float radialLayer = edgeSample ? 1.0 : layer;
  vec3 point;

  if (mode < 0.5) {
    // Corner cuts sweep through a solid block. Eight triangular faces grow as
    // square faces recede, then a different set of corners opens again.
    vec3 extent = vec3(0.82 + 0.15 * sin(phase),
                       0.79 + 0.17 * sin(phase + 2.2),
                       0.81 + 0.15 * cos(phase + 0.4));
    float corner = 1.48 + 0.53 * sin(phase * 0.84 + 0.8);
    vec3 cutDirection = direction;
    cutDirection.xz = rotate(cutDirection.xz, 0.20 * sin(phase * 0.71));
    float cornerRadius = corner / dot(abs(cutDirection), vec3(1.0));
    float radius = min(polyBoxRadius(direction, extent), cornerRadius);
    point = direction * radius;
    if (edgeSample) point = polyNearestEdge(point, 0.0, extent, vec4(corner, 0.0, 0.0, 0.20 * sin(phase * 0.71)));
    point *= radialLayer;
    point.x += 0.19 * sin(phase * 0.73) * point.y;
    point.z += 0.15 * cos(phase * 0.81) * point.x;
  } else if (mode < 1.5) {
    // Five intersecting blocks remain one connected mass. Neighbor dimensions
    // and centers are coupled, so their shoulders grow without floating apart.
    float member = min(4.0, floor(part * 5.0));
    vec3 extent;
    vec3 center = vec3(0.0);
    if (member < 0.5) {
      extent = vec3(0.53 + 0.10 * sin(phase),
                    0.57 + 0.13 * cos(phase * 0.86),
                    0.54 + 0.10 * sin(phase + 1.0));
    } else if (member < 1.5) {
      extent = vec3(0.41 + 0.11 * sin(phase + 0.4),
                    0.42 + 0.15 * cos(phase + 0.8),
                    0.45 + 0.09 * sin(phase + 1.7));
      center = vec3(-0.58 - 0.08 * sin(phase), -0.20, 0.12);
    } else if (member < 2.5) {
      extent = vec3(0.39 + 0.12 * sin(phase + 2.2),
                    0.46 + 0.15 * cos(phase + 2.8),
                    0.38 + 0.08 * sin(phase + 0.6));
      center = vec3(0.57 + 0.08 * cos(phase), 0.18, -0.10);
    } else if (member < 3.5) {
      extent = vec3(0.38 + 0.09 * cos(phase + 0.4),
                    0.39 + 0.11 * sin(phase + 1.2),
                    0.43 + 0.10 * cos(phase + 1.4));
      center = vec3(-0.12, 0.59 + 0.08 * sin(phase + 0.5), -0.12);
    } else {
      extent = vec3(0.43 + 0.08 * sin(phase + 1.6),
                    0.37 + 0.12 * cos(phase + 0.3),
                    0.42 + 0.11 * sin(phase + 2.4));
      center = vec3(0.14, -0.28, 0.58 + 0.08 * cos(phase + 1.0));
    }
    float radius = polyBoxRadius(direction, extent);
    float bevel = dot(extent, vec3(1.0)) - 0.08 - 0.10 * (0.5 + 0.5 * sin(phase + member));
    radius = min(radius, bevel / dot(abs(direction), vec3(1.0)));
    point = direction * radius;
    if (edgeSample) point = polyNearestEdge(point, 0.0, extent, vec4(bevel, 0.0, 0.0, 0.0));
    point = center + point * radialLayer;
    point.x += point.y * (0.10 + 0.12 * sin(phase * 0.7));
    point.z += point.y * 0.13 * cos(phase * 0.66);
  } else if (mode < 2.5) {
    // A compact cluster of seven closed hexagonal columns. The six neighbors
    // intersect a broad core, while their cap heights pass in a slow wave.
    float member = min(6.0, floor(part * 7.0));
    float bearing = (member - 1.0) * PI / 3.0;
    float outer = step(0.5, member);
    vec3 center = vec3(0.62 * cos(bearing), 0.0, 0.62 * sin(bearing)) * outer;
    float halfHeight = 0.68 + 0.23 * sin(phase + member * 0.94);
    float width = 0.33 + 0.06 * cos(phase * 0.8 + member * 0.72);
    if (member < 0.5) { halfHeight = 0.83 + 0.17 * cos(phase); width = 0.40; }
    float localAngle = atan(direction.z, direction.x);
    float sector = mod(localAngle + PI / 6.0, PI / 3.0) - PI / 6.0;
    float side = length(direction.xz) * cos(sector) / width;
    float cap = abs(direction.y) / halfHeight;
    float radius = 1.0 / max(side, cap);
    point = direction * radius;
    if (edgeSample) point = polyNearestEdge(point, 1.0, vec3(width, halfHeight, width), vec4(0.0));
    point = center + point * radialLayer;
    point.y += outer * (0.12 * sin(phase + member) - 0.08);
    point.x += point.y * 0.17 * sin(phase * 0.7);
    point.z += point.y * 0.10 * cos(phase * 0.8);
    point *= 1.07;
  } else if (mode < 3.5) {
    // Three intersecting tetrahedra make a pointed but weighty central object.
    // Independent plane supports move the vertices, while truncation replaces
    // tips with small facets and changes the outline beyond a rigid rotation.
    float member = min(2.0, floor(part * 3.0));
    vec3 localDirection = direction;
    localDirection.yz = rotate(localDirection.yz, member * 1.22);
    localDirection.xz = rotate(localDirection.xz, member * 0.87);
    vec4 support = vec4(0.66 + 0.13 * sin(phase + member),
                        0.65 + 0.12 * cos(phase * 0.87 + member),
                        0.65 + 0.12 * sin(phase * 0.93 + member + 2.0),
                        0.67 + 0.12 * cos(phase + member + 1.0));
    float radius = polyTetraRadius(localDirection, support);
    float clipping = 0.97 + 0.14 * sin(phase * 0.76 + member * 1.7);
    radius = min(radius, polyBoxRadius(localDirection, vec3(clipping)));
    point = localDirection * radius;
    if (edgeSample) point = polyNearestEdge(point, 2.0, vec3(clipping), support);
    point *= radialLayer;
    point.xz = rotate(point.xz, -member * 0.87);
    point.yz = rotate(point.yz, -member * 1.22);
    point *= member < 0.5 ? 0.90 : 0.72;
    if (member > 0.5 && member < 1.5) point += vec3(-0.27, 0.15, 0.09);
    if (member > 1.5) point += vec3(0.29, -0.15, -0.11);
    point.x += point.y * 0.19 * sin(phase * 0.68);
  } else {
    // Twelve true rhombic facets share a full three-dimensional interior. Three
    // support families trade area; additional square facets grow at the tips.
    vec3 absolute = abs(direction);
    vec3 span = vec3(1.16 + 0.25 * sin(phase),
                    1.18 + 0.24 * sin(phase + 2.1),
                    1.14 + 0.24 * sin(phase + 4.2));
    float support = max((absolute.x + absolute.y) / span.x,
                        max((absolute.y + absolute.z) / span.y,
                            (absolute.z + absolute.x) / span.z));
    float radius = 1.0 / support;
    vec3 extent = vec3(1.01 + 0.19 * cos(phase * 0.81),
                       1.02 + 0.18 * sin(phase * 0.81),
                       1.01 + 0.19 * cos(phase * 0.81 + 1.8));
    radius = min(radius, polyBoxRadius(direction, extent));
    point = direction * radius;
    if (edgeSample) point = polyNearestEdge(point, 3.0, extent, vec4(span, 0.0));
    point *= radialLayer;
    point.z += point.y * 0.27 * sin(phase * 0.73);
    point.x += point.z * 0.18 * cos(phase * 0.69);
  }
  return point;
}

`;
