export const volumeShapes = `
// Stable particle identities travel through sections that change their skin,
// proportions, and attachment to neighboring regions throughout the loop.
float organicMember(float part, float mode) {
  float count = mode > 9.5 ? 63.0 : mode >= 2.5 ? 12.0 : mode >= 0.5 && mode < 1.5 ? 10.0 : 9.0;
  return min(count - 1.0, floor(part * count));
}

float organicBranchDepth(float member) {
  return member < 1.0 ? 0.0 : member < 3.0 ? 1.0 : member < 7.0 ? 2.0
    : member < 15.0 ? 3.0 : member < 31.0 ? 4.0 : 5.0;
}

float organicBranchGrowth(float depth, float time) {
  return smoothstep(2.0 + 0.95 * depth, 5.2 + 2.16 * depth, time);
}

float organicOrder(float part, float time, float mode) {
  if (mode > 9.5) return 0.995;
  if (mode >= 2.5) {
    return 0.97 + 0.02 * sin(time * 0.31 - part * 4.2 + mode);
  }
  float region = part * (4.7 + 0.31 * mode);
  return 0.93 + 0.045 * sin(time * 0.38 - region)
    + 0.020 * sin(time * 0.23 + 1.7 * region + mode);
}

float organicLife(float member, float time, float mode) {
  float clock = time - 6.0;
  float phase = clock * 1.02 - member * 1.31 + mode * 0.57;
  phase += 0.34 * sin(clock * 0.53 + member * 0.91 + mode * 0.41);
  return 0.5 + 0.5 * sin(phase);
}

float organicPresence(float part, float time, float mode) {
  if (mode > 9.5) {
    float depth = organicBranchDepth(organicMember(part, mode));
    // Surface area grows with segment length times its growing radius.
    // This keeps young short branches from concentrating a full cohort at a fork.
    float growth = organicBranchGrowth(depth, time);
    return pow(growth, 1.5) * (0.70 + 0.30 * pow(0.83, depth));
  }
  if (mode >= 2.5) {
    // Neighboring current fronts remain present while their geometry changes.
    return 0.86 + 0.10 * sin((time - 6.0) * 0.36 - organicMember(part, mode) * 0.43);
  }
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
  z -= cap * (0.39 + 0.24 * cos(phase)) * pocket * front * front;
  z += (0.19 + 0.25 * sin(phase * 0.71)) * (a * a - 0.55 * y * y);
  z += 0.18 * cap * cos(4.2 * a + phase);
  return vec3(0.91 * a, y * layer, z * layer);
}

// A substantial chamber with a scalloped mouth and an offset inward pocket.
// Both ends close smoothly; the mouth is surface curvature rather than a cut.
vec3 organicAlveolus(float a, float angle, float layer, float phase) {
  float cap = organicCap(a);
  float shoulder = 0.60 + 0.13 * sin(phase * 0.71 + 2.0 * a);
  float scallop = 1.0 + 0.16 * cos(3.0 * angle + 1.5 * a - phase);
  float cross = cap * cos(angle);
  float y = cross * shoulder * scallop;
  float z = cap * sin(angle) * (0.46 + 0.11 * cos(phase * 0.83 - a));
  float front = max(0.0, sin(angle));
  float pocketX = a - 0.22 * sin(phase * 0.67);
  float pocketY = y - 0.12 * cos(phase * 0.79);
  float pocket = exp(-5.2 * pocketX * pocketX - 6.5 * pocketY * pocketY);
  z -= cap * (0.55 + 0.17 * sin(phase * 0.73)) * pocket * front * front;
  z += cap * (0.15 * sin(3.2 * a + phase) + 0.10 * cross * cos(phase * 0.61));
  y += cap * 0.13 * sin(2.4 * a - phase * 0.77);
  return vec3(0.81 * a, y * layer, z * layer);
}

// Broad open-ended current fronts never collapse to a common upstream pole.
// Wavelength, direction, phase, and amplitude vary coherently between fronts.
vec3 organicThalassa(float a, float angle, float layer, float member, float time) {
  float along = 0.5 + 0.5 * a;
  float lane = mod(member, 4.0) - 1.5;
  float stratum = floor(member / 4.0) - 1.0;
  float clock = time - 6.0;
  float direction = mod(member, 3.0) < 0.5 ? -1.0 : 1.0;
  float speed = 0.46 + 0.085 * mod(member, 4.0);
  float phase = clock * speed * direction + lane * 0.92 + stratum * 0.47;
  float swell = 0.30 + 0.70 * along;
  float fan = 0.62 + 0.48 * along;
  float growth = 0.83 + 0.17 * smoothstep(2.0, 11.0, time);
  float cross = cos(angle);
  float width = (0.23 + 0.10 * along) * (1.0 + 0.19 * sin(2.2 * a - phase));
  float depth = 0.085 + 0.033 * along + 0.020 * cos(2.8 * a + phase * 0.71);
  vec3 p = vec3(1.28 * a, cross * width * layer, sin(angle) * depth * layer);
  p.y += lane * 0.44 * fan;
  p.z += stratum * (0.44 + 0.06 * sin(clock * 0.37 + lane)) * fan;
  p.y += swell * ((0.22 + 0.045 * cos(member * 1.3)) * sin((1.7 + 0.17 * stratum) * a - phase)
    + 0.095 * sin(3.7 * a + clock * (0.33 + member * 0.019) + lane * 1.1));
  p.z += swell * ((0.28 + 0.07 * sin(member * 0.9)) * sin((2.5 + 0.20 * lane) * a + 1.3 * cross - phase)
    + 0.13 * cos(4.2 * a - 1.5 * cross + phase * 0.61 + stratum));
  // Direction changes develop along each front instead of rotating the whole bank.
  p.yz = rotate(p.yz, 0.29 * sin(1.7 * a - phase * 0.69) + 0.11 * stratum);
  p.y *= growth * (0.99 + 0.10 * sin(clock * 0.45 + 1.8 * a + lane));
  p.z *= growth * (0.99 + 0.10 * cos(clock * 0.39 - 1.6 * a + stratum));
  p.x += 0.045 * sin(1.7 * cross - phase) * swell;
  return 0.96 * p / sqrt(vec3(1.0) + 0.13 * p * p);
}

// Three separated broad rollers each carry four coordinated curved skins.
// Most motion is in their crests and troughs, so overlap does not become haze.
vec3 organicMaelstrom(float a, float angle, float layer, float member, float time) {
  float along = 0.5 + 0.5 * a;
  float family = floor(member / 4.0);
  float lane = mod(member, 4.0) - 1.5;
  float clock = time - 6.0;
  float fan = 0.50 + 0.57 * along;
  float growth = 0.82 + 0.18 * smoothstep(2.0, 11.0, time);
  float phase = clock * (0.78 + 0.11 * family) + family * 2.03;
  float handedness = family < 1.5 ? 1.0 : -1.0;
  float cross = organicSignedPower(cos(angle), 0.88);
  float crest = (2.8 + 0.26 * family) * a - phase;
  float width = (0.19 + 0.11 * along) * (1.0 + 0.18 * sin(crest));
  float thickness = 0.095 + 0.033 * along + 0.016 * cos(crest * 1.17);
  vec3 p = vec3(1.25 * a, cross * width * layer + lane * 0.23 * fan, sin(angle) * thickness * layer);
  p.z += (0.28 + 0.06 * sin(phase * 0.67)) * sin(crest + 1.45 * cross)
    + 0.075 * cos(4.4 * a - phase * 0.72 + lane * 0.19);
  // Four skins roll together; lane shifts do not introduce competing vortices.
  float roll = handedness * (0.65 * phase + 1.9 * a + 0.38 * sin(1.9 * a - phase * 0.51));
  p.yz = rotate(p.yz, roll);
  float bearing = family * 2.094 + 0.12 * sin(clock * 0.40 + family);
  p.yz += fan * vec2(0.59 * cos(bearing), 0.50 * sin(bearing));
  p.y += 0.12 * sin(2.4 * a - phase * 0.62);
  p.z += 0.12 * cos(2.0 * a + phase * 0.58);
  p.y *= growth * (0.99 + 0.09 * sin(clock * 0.59 + 1.7 * a));
  p.z *= growth * (0.99 + 0.10 * cos(clock * 0.53 - 1.8 * a));
  p.x += 0.065 * sin(2.0 * cross + phase * 0.57);
  return 0.97 * p / sqrt(vec3(1.0) + 0.14 * p * p);
}

// Every segment reconstructs its ancestors, so bifurcations share moving nodes.
// A fixed six-level walk keeps WebGL 1 compilation predictable.
vec3 organicPlexus(float a, float angle, float layer, float member, float time) {
  float depth = organicBranchDepth(member);
  float path = member - (exp2(depth) - 1.0);
  float prefix = 0.0;
  float clock = time - 6.0;
  vec3 origin = vec3(-1.21, -0.05, 0.0);
  vec3 direction = normalize(vec3(1.0, 0.04, 0.02));
  float branchLength = 0.45;
  float growth = organicBranchGrowth(0.0, time);
  for (int step = 0; step < 6; step++) {
    float level = float(step);
    if (level <= depth) {
      if (step > 0) {
        float bit = mod(floor(path / exp2(depth - level)), 2.0);
        float side = bit * 2.0 - 1.0;
        prefix = prefix * 2.0 + bit;
        float fork = 0.56 + 0.13 * sin(clock * 0.34 + prefix * 0.81 + level);
        direction.xy = rotate(direction.xy, side * fork);
        direction.xz = rotate(direction.xz, side * (0.33 + 0.17 * sin(level * 1.71 + prefix * 0.66)));
        direction.yz = rotate(direction.yz, 0.30 * sin(level * 1.63 + prefix * 0.71 + clock * 0.29));
        direction = normalize(direction);
      }
      float fullLength = step == 0 ? 0.45 : 0.70 * pow(0.86, level - 1.0) * (0.96 + 0.07 * sin(prefix * 1.71 + level));
      growth = organicBranchGrowth(level, time);
      branchLength = fullLength * max(0.0001, growth);
      if (level < depth) origin += direction * branchLength;
    }
  }
  float along = 0.5 + 0.5 * a;
  vec3 side = normalize(cross(direction, vec3(0.137, 0.263, 1.0)));
  vec3 normal = normalize(cross(side, direction));
  vec3 bend = (side * sin(member * 1.07 + clock * 0.41)
    + normal * 0.76 * cos(member * 0.83 - clock * 0.37)) * branchLength * 0.14;
  vec3 p = origin + direction * branchLength * along + bend * sin(PI * along);
  vec3 tangent = normalize(direction * branchLength + bend * (PI * cos(PI * along)));
  side = normalize(cross(tangent, vec3(0.137, 0.263, 1.0)));
  normal = normalize(cross(side, tangent));
  float radius = 0.135 * pow(0.73, depth) * (1.0 - 0.24 * along);
  radius *= sqrt(growth) * (1.0 + 0.11 * sin(4.2 * along - clock * 0.60 + member * 0.43));
  if (depth > 4.5) radius *= 1.0 - smoothstep(0.72, 1.0, along);
  p += (side * cos(angle) + normal * sin(angle)) * radius * layer;
  // This field acts on shared positions, preserving connected junctions.
  p.z += 0.085 * sin(1.8 * p.x + 1.2 * p.y - clock * 0.31);
  p.y += 0.07 * sin(1.6 * p.x - 1.3 * p.z + clock * 0.27);
  // A broad horizontal envelope matches the canvas while preserving depth.
  p.y *= 0.515;
  return p / sqrt(vec3(1.0) + vec3(0.065, 0.105, 0.10) * p * p);
}

vec3 organicVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float a = clamp(axial, -1.0, 1.0);
  float member = organicMember(part, mode);
  if (mode > 9.5) return organicPlexus(a, angle, layer, member, time);
  if (mode >= 2.5) {
    return mode < 3.5
      ? organicThalassa(a, angle, layer, member, time)
      : organicMaelstrom(a, angle, layer, member, time);
  }
  float phase = (time - 6.0) * 0.88 - member * 0.94;
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
    } else if (member < 6.0) {
      p = mix(organicVault(a, angle, layer, phase), organicMuscle(a, angle, layer, phase - 0.8), change) * vec3(0.76, 0.80, 0.91);
      float bearing = (member - 3.0) * 2.12 + 0.31 + 0.35 * sin(phase * 0.63);
      center = vec3((0.25 + 0.25 * life) * cos(bearing), (0.27 + 0.26 * life) * sin(bearing), 0.13 + 0.19 * wave);
      angles = vec3(0.54 * sin(bearing) + 0.61 * wave, 0.42 * cos(bearing), bearing * 0.68 + 0.38 * wave);
    } else {
      // Peripheral shoulders bridge the old body to new outer pockets.
      float branch = member - 6.0;
      float bearing = branch * 2.14 - 0.72 + 0.22 * sin(phase * 0.63);
      p = mix(organicVault(a, angle, layer, phase + 0.5), organicMuscle(a, angle, layer, phase - 0.4), change * 0.78);
      p *= vec3(0.82, 0.68, 0.78);
      center = vec3((0.67 + 0.13 * life) * cos(bearing), (0.62 + 0.15 * life) * sin(bearing), -0.14 + 0.25 * cos(branch * 2.2 + phase * 0.62));
      angles = vec3(0.52 * wave, 0.35 * cos(bearing) + 0.20 * wave, bearing + 0.26 * wave);
    }
    float pair = floor(member * 0.5);
    mergeCenter = member < 6.0
      ? vec3(0.21 * sin(pair * 2.1), 0.17 * cos(pair * 2.1), -0.06)
      : center * vec3(0.80, 0.80, 0.65);
  } else if (mode < 1.5) {
    // Chitin: oblique armor lobes grow from a shared irregular muscular spine.
    if (member < 5.0) {
      p = mix(organicVault(a, angle, layer, phase), organicMuscle(a, angle, layer, phase + 0.9), change * 0.85);
      p *= vec3(0.62 + 0.055 * cos(member), 0.70, 1.02);
      float side = mod(member, 2.0) < 0.5 ? -1.0 : 1.0;
      center = vec3((-0.60 + 0.30 * member) * (0.96 + 0.22 * sin((time - 6.0) * 0.61)), side * (0.16 + 0.32 * life), 0.21 * cos(member * 1.7 + phase * 0.64));
      angles = vec3(side * 0.54 + 0.63 * wave, 0.44 + 0.44 * cos(phase * 0.8), side * (0.53 + 0.46 * wave));
    } else if (member < 7.0) {
      float side = member < 5.5 ? -1.0 : 1.0;
      p = organicMuscle(a, angle, layer, phase) * vec3(1.04, 0.47 + 0.18 * change, 0.64);
      center = vec3(0.10 * wave, side * 0.15, -0.24 + 0.18 * cos(phase));
      angles = vec3(side * 0.26 + 0.50 * wave, 0.30 * cos(phase), side * 0.18);
    } else {
      float crown = member - 7.0;
      float bearing = crown * 2.26 - 0.30 + 0.22 * sin(phase * 0.70);
      p = mix(organicVault(a, angle, layer, phase), organicMuscle(a, angle, layer, phase + 0.9), change * 0.65);
      p *= vec3(0.79, 0.72, 0.87);
      center = vec3((0.73 + 0.13 * life) * cos(bearing), (0.63 + 0.13 * life) * sin(bearing), 0.17 + 0.18 * cos(phase * 0.74 + crown));
      angles = vec3(0.56 * sin(bearing) + 0.44 * wave, 0.38 * cos(phase * 0.70), bearing + 0.32 * wave);
    }
    mergeCenter = member < 7.0
      ? vec3(member < 5.0 ? (member - 2.0) * 0.12 : 0.0, 0.0, -0.15)
      : center * vec3(0.82, 0.82, 0.60);
  } else if (mode < 2.5) {
    // Alveoli: an irregular crown of recessed chambers surrounds a lower hub.
    // Outer rooms retain their reach while their mouth and bulge exchange mass.
    float room = mod(member, 3.0);
    float tier = floor(member / 3.0);
    float bearing = room * 2.12 + tier * 0.73 + 0.22 * sin(phase * 0.63);
    float reach = tier < 0.5 ? 0.24 : tier < 1.5 ? 0.69 : 0.76;
    float elevation = tier < 0.5 ? -0.18 : tier < 1.5 ? 0.12 : -0.10;
    p = organicAlveolus(a, angle, layer, phase);
    p = mix(p, organicVault(a, angle, layer, phase * 0.83), 0.24 + 0.24 * sin(phase * 0.59));
    p *= vec3(0.83 + 0.08 * cos(bearing), 0.92, 0.94);
    center = vec3(reach * cos(bearing), elevation + reach * 0.90 * sin(bearing), (tier - 1.0) * 0.27 + 0.14 * sin(phase * 0.71));
    center.xy += 0.12 * vec2(sin(phase * 0.77), cos(phase * 0.67));
    angles = vec3(0.24 + 0.51 * sin(bearing) + 0.34 * wave, (tier - 1.0) * 0.30 + 0.36 * cos(phase * 0.69), bearing * 0.54 + 0.31 * wave);
    mergeCenter = center * vec3(0.82, 0.82, 0.72);
  }

  // Sections keep their peripheral attachment while changing proportions.
  // A high size floor leaves a broad assembly as individual regions recede.
  p *= vec3(0.95 + 0.30 * sin(phase * 0.74 + 0.4), 0.96 - 0.32 * sin(phase * 0.74 + 0.4), 0.94 + 0.30 * cos(phase * 0.83 - 0.3));
  p *= 0.90 + 0.16 * life;
  center = mix(mergeCenter, center, 0.67 + 0.33 * life);
  p = organicTurn(p, angles) + center;
  float clock = (time - 6.0) * 0.67;
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
  if (mode < 0.5) return 24.0;
  if (mode < 1.5) return 168.0;
  if (mode < 2.5) return 24.0;
  if (mode < 3.5) return 21.0;
  return 100.0;
}

float polyhedralOrder(float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  // Coherence stays high enough for moving facets to read. Presence, below,
  // controls gradual turnover independently of the particle flow field.
  float wave = 0.07 * sin((time - 6.0) * 0.57 + member * 1.71)
               + 0.03 * sin((time - 6.0) * 0.37 + member * 2.39 + mode * 0.8);
  // Small Druse facets need little residual displacement. Their anatomy still
  // changes substantially through local proportions, spacing, and shared pose.
  if (mode > 0.5 && mode < 1.5) return 0.965 + wave * 0.35;
  // Hypercell's neighboring projected cells need a quieter skin so their
  // independently changing planes remain distinct through the shared field.
  if (mode > 1.5 && mode < 2.5) return 0.95 + wave * 0.5;
  if (mode > 3.5) return 0.96 + wave * 0.4;
  return 0.90 + wave;
}

float polyPresenceMember(float member, float time, float mode) {
  if (mode > 3.5) {
    // The common core and rooted stems retain visible connections while
    // smaller daughter growths gradually trade prominence.
    if (member < 3.5) return 1.0;
    float site = floor((member - 4.0) / 3.0);
    float tier = mod(member - 4.0, 3.0);
    float wave = 0.5 + 0.5 * sin((time - 6.0) * (0.61 + 0.047 * tier)
                                + site * 2.399963 + tier * 1.71);
    return tier < 0.5 ? 0.82 + 0.18 * wave : 0.65 + 0.35 * wave;
  }
  float phase = (time - 6.0) * (0.96 + 0.045 * mod(member, 3.0) + 0.028 * mode);
  phase += member * 2.399963 + mode * 0.71;
  phase += 0.24 * sin((time - 6.0) * 0.43 + member * 0.83);
  // A broad sinusoid has no timed gates or identity changes. Geometry draws
  // a receding section toward its local relatives without erasing its reach.
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

vec3 polyTetrarchArm(float index) {
  if (index < 3.5) return polyTetraVertex(index);
  return normalize(vec3(0.85, -0.05, 0.35)) * (index < 4.5 ? 1.0 : -1.0);
}

vec3 polyAlongAxis(vec3 point, vec3 axis) {
  axis = normalize(axis);
  // These construction axes stay away from the Z pole.
  vec3 tangent = normalize(vec3(-axis.y, axis.x, 0.0));
  return tangent * point.x + axis * point.y + cross(tangent, axis) * point.z;
}

vec3 polyRadialFrame(vec3 point, vec3 axis) {
  // The shortest rotation from +Y avoids a spinning tangent near the Z pole.
  // The construction axes stay away from the opposite (-Y) direction.
  vec3 turn = vec3(axis.z, 0.0, -axis.x);
  vec3 first = cross(turn, point);
  return point + first + cross(turn, first) / (1.0 + axis.y);
}

vec3 polyAperiodicCoreExtent(float phase) {
  return vec3(0.355, 0.315, 0.345)
          + vec3(0.045, 0.038, 0.043) * sin(vec3(0.53, 0.61, 0.47) * phase + vec3(0.0, 1.1, 2.3));
}

vec3 polyAperiodicCore(vec3 direction, float layer, float phase) {
  vec3 extent = polyAperiodicCoreExtent(phase);
  vec3 spans = vec3(extent.x + extent.y, extent.y + extent.z, extent.z + extent.x)
                * (vec3(0.735) + vec3(0.055) * sin(vec3(0.57, 0.49, 0.63) * phase + vec3(0.4, 1.7, 2.8)));
  return polyPrimitive(direction, layer, 3.0, extent, vec4(spans, 0.0));
}

float polyAperiodicGrowth(float site, float phase) {
  float wave = phase * (0.68 + 0.015 * mod(site, 5.0)) + site * 2.399963;
  return 0.5 + 0.5 * sin(wave + 0.23 * sin(phase * 0.34 + site));
}

vec3 polyhedralVolume(float axial, float angle, float layer, float part, float time, float mode) {
  float count = polyMemberCount(mode);
  float member = min(count - 1.0, floor(part * count));
  float phase = time - 6.0;
  float local = member * 1.927;
  float presence = polyPresenceMember(member, time, mode);
  float growth = 0.64 + 0.36 * presence;
  vec3 direction = polyDirection(axial, angle);

  if (mode < 0.5) {
    // Six parent arms carry four chambers each. The additional oblique arms
    // occupy the periphery while every family retains its own changing tips.
    float parent = floor(member / 4.0);
    float child = mod(member, 4.0);
    float parentPhase = parent * 1.73;
    vec3 parentAngles = vec3(0.52 * sin(phase * 0.52 + parentPhase),
                             0.59 * sin(phase * 0.43 + parentPhase + 0.8),
                             0.46 * cos(phase * 0.61 + parentPhase));
    vec3 parentCenter = polyTetrarchArm(parent) * (0.52 + 0.16 * sin(phase * 0.64 + parentPhase));
    parentCenter *= vec3(0.98 + 0.22 * sin(phase * 0.56),
                         0.98 + 0.24 * cos(phase * 0.47),
                         0.98 + 0.20 * sin(phase * 0.51 + 1.0));
    vec3 childCenter = polyTetraVertex(child) * (0.17 + 0.20 * presence);
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
    // Seven intergrown aggregates carry four terraces of six small crystals.
    // All 168 identities persist; changing overlap exposes different
    // facet layers without a trunk, a dominant block, or a timed birth gate.
    float aggregate = floor(member / 24.0);
    float terrace = floor(mod(member, 24.0) / 6.0);
    float crystal = mod(member, 6.0);
    float familyPhase = aggregate * 1.731;
    float latitude = 0.78 - aggregate * 0.26;
    float bearing = aggregate * 2.399963;
    vec3 familyAxis = vec3(sqrt(1.0 - latitude * latitude) * cos(bearing),
                           latitude, sqrt(1.0 - latitude * latitude) * sin(bearing));
    familyAxis.xy = rotate(familyAxis.xy, 0.22 * sin(phase * 0.49 + familyPhase));
    familyAxis.yz = rotate(familyAxis.yz, 0.25 * cos(phase * 0.57 + familyPhase));
    float reach = 0.58 + 0.09 * sin(phase * 0.61 + familyPhase);
    vec3 center = familyAxis * reach;
    center += vec3(0.11 * sin(phase * 0.55 + familyPhase),
                    0.10 * cos(phase * 0.48 + familyPhase + 0.7),
                    0.09 * sin(phase * 0.67 + familyPhase + 1.2));

    // Successive terraces trade lateral reach and height. Their six crystals
    // share a slow turn but have independent support-plane proportions.
    float terracePhase = familyPhase + terrace * 1.17;
    float azimuth = crystal * PI / 3.0 + terrace * 0.49;
    azimuth += 0.31 * sin(phase * 0.58 + terracePhase);
    float radius = (0.225 - terrace * 0.030)
                    * (0.91 + 0.23 * sin(phase * 0.63 + terracePhase));
    float rise = (terrace - 1.5) * (0.105 + 0.035 * cos(phase * 0.52 + familyPhase));
    vec3 localCenter = vec3(radius * cos(azimuth), rise, radius * sin(azimuth));
    localCenter.xz += vec2(sin(phase * 0.66 + terracePhase),
                            cos(phase * 0.59 + terracePhase)) * 0.040;
    float inclination = 0.31 + terrace * 0.09 + 0.22 * sin(phase * 0.64 + local);
    vec3 axis = normalize(vec3(inclination * cos(azimuth), 1.0,
                                inclination * sin(azimuth)));
    float widthBase = terrace < 0.5 ? 0.078 : terrace < 1.5 ? 0.062 : terrace < 2.5 ? 0.050 : 0.039;
    float heightBase = terrace < 0.5 ? 0.112 : terrace < 1.5 ? 0.165 : terrace < 2.5 ? 0.148 : 0.129;
    float width = widthBase * (0.97 + 0.27 * sin(phase * 0.73 + local));
    float height = heightBase * (0.98 + 0.35 * cos(phase * 0.69 + local + 0.5));
    float localGrowth = 0.82 + 0.18 * presence;
    width *= localGrowth;
    height *= localGrowth;
    float shoulder = height * (0.54 + 0.21 * sin(phase * 0.61 + local));
    vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, height, width),
                                vec4(shoulder, 0.0, 0.0, 0.0));
    point.xz = rotate(point.xz, crystal * 0.23 + 0.24 * sin(phase * 0.57 + local));
    point = localCenter + polyAlongAxis(point, axis);
    point.xy = rotate(point.xy, 0.38 * sin(phase * 0.53 + familyPhase));
    point.xz = rotate(point.xz, 0.41 * cos(phase * 0.47 + familyPhase));
    return center + polyRadialFrame(point, familyAxis);
  }

  if (mode < 2.5) {
    // Three displaced eight-cell families keep their own projected structure.
    // Smaller face spans and persistent cell offsets leave readable boundaries
    // instead of accumulating three nearly coincident skins at the origin.
    float cell = mod(member, 8.0);
    float family = floor(member / 8.0);
    float fixedAxis = floor(cell / 2.0);
    float side = mod(cell, 2.0) * 2.0 - 1.0;
    float cellPhase = cell * 1.31 + family * 1.17;
    vec3 extent = (vec3(0.275, 0.255, 0.27)
                    + vec3(0.085, 0.075, 0.08) * sin(vec3(0.58, 0.73, 0.65) * phase + cellPhase))
                  * (0.87 + 0.13 * presence);
    float cut = dot(extent, vec3(1.0)) * (0.80 + 0.10 * sin(phase * 0.68 + cellPhase));
    vec3 point = polyPrimitive(direction, layer, 0.0, extent, vec4(cut, 0.0, 0.0, 0.0));
    float fixedCoordinate = side * (0.40 + 0.12 * presence) * (1.0 + 0.10 * cos(phase * 0.62 + cellPhase));
    vec4 space;
    if (fixedAxis < 0.5) space = vec4(fixedCoordinate, point.x, point.y, point.z);
    else if (fixedAxis < 1.5) space = vec4(point.x, fixedCoordinate, point.y, point.z);
    else if (fixedAxis < 2.5) space = vec4(point.x, point.y, fixedCoordinate, point.z);
    else space = vec4(point, fixedCoordinate);
    space.xw = rotate(space.xw, 0.48 + 0.68 * sin(phase * 0.56) + family * 0.54);
    space.zw = rotate(space.zw, 0.36 + 0.61 * sin(phase * 0.67 + 0.7) - family * 0.46);
    space.yw = rotate(space.yw, 0.56 * sin(phase * 0.48 + 1.0 + family * 0.27));
    space.yz = rotate(space.yz, 0.25 * sin(phase * 0.41));
    vec3 projected = space.xyz * (2.25 / (2.25 - space.w));
    float bearing = family * 2.0 * PI / 3.0 + 0.22 * sin(phase * 0.43 + family);
    float reach = 0.55 + 0.085 * sin(phase * 0.59 + family * 1.71);
    vec3 center = vec3(reach * cos(bearing), reach * sin(bearing), 0.20 * sin(family * 2.1 + phase * 0.49));
    return polySectionPose(projected, center,
                            vec3(0.16 * sin(phase * 0.57 + family),
                                 family * 0.31, 0.18 * cos(phase * 0.61 + family)));
  }

  if (mode < 3.5) {
    // Seven stems carry twenty-one chambers around a persistent wider crown.
    // Daughter spires recede locally without pulling every stem to the center.
    float parent = floor(member / 3.0);
    float tier = mod(member, 3.0);
    float bearing = parent * 2.0 * PI / 7.0;
    float parentPhase = parent * 1.69;
    float parentPresence = polyPresenceMember(parent * 3.0, time, mode);
    float spread = 0.56 + 0.29 * sin(phase * 0.59 + parentPhase * 0.31);
    vec3 axis = normalize(vec3(spread * cos(bearing), 0.82, spread * sin(bearing)));
    axis.xy = rotate(axis.xy, 0.35 * sin(phase * 0.62 + parentPhase));
    axis.yz = rotate(axis.yz, 0.39 * cos(phase * 0.53 + parentPhase));
    float radius = (0.46 + 0.10 * sin(phase * 0.64 + parentPhase)) * (0.86 + 0.14 * parentPresence);
    vec3 center = vec3(radius * cos(bearing), -0.25 + 0.14 * sin(phase * 0.68 + parentPhase), radius * sin(bearing));
    float width = 0.22 + 0.075 * sin(phase * 0.73 + parentPhase);
    float height = (0.51 + 0.22 * cos(phase * 0.62 + parentPhase)) * (0.70 + 0.30 * parentPresence);
    if (tier > 0.5) {
      float side = tier * 2.0 - 3.0;
      float shoulderDistance = 0.16 + 0.18 * presence;
      vec3 shoulder = vec3(shoulderDistance * cos(bearing + side * 0.77), 0.0,
                           shoulderDistance * sin(bearing + side * 0.77));
      center += axis * height * (0.32 + 0.42 * presence) + shoulder;
      axis.xy = rotate(axis.xy, side * (0.43 + 0.29 * sin(phase * 0.61 + parentPhase)) * (0.62 + 0.38 * presence));
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

  // Four material sectors cover one continuous core; they are not four
  // coincident solids. Thirty-two rooted spires each carry two smaller
  // daughter growths, giving 96 crystals in one connected layered assembly.
  if (member < 3.5) {
    return polyAperiodicCore(polyDirection(axial, angle * 0.25 + member * PI * 0.5), layer, phase);
  }
  float site = floor((member - 4.0) / 3.0);
  float tier = mod(member - 4.0, 3.0);
  float sitePhase = site * 2.399963;
  float latitude = 0.86 - 1.72 * (site + 0.5) / 32.0;
  float bearing = sitePhase + 0.13 * sin(phase * 0.43 + site * 0.71);
  vec3 radial = vec3(sqrt(1.0 - latitude * latitude) * cos(bearing), latitude,
                     sqrt(1.0 - latitude * latitude) * sin(bearing));
  radial.xy = rotate(radial.xy, 0.09 * sin(phase * 0.47 + sitePhase));
  vec3 coreExtent = polyAperiodicCoreExtent(phase);
  // A continuous radial normal approximation follows the changing core
  // without jumping between its discrete facet normals.
  vec3 axis = normalize(radial / (coreExtent * coreExtent));
  vec3 anchor = polyAperiodicCore(radial, 1.0, phase) - axis * 0.095;
  float stemGrowth = polyAperiodicGrowth(site, phase);
  bool longStem = mod(site, 5.0) < 0.5;
  float stemLength = longStem ? 0.32 + 0.72 * stemGrowth : 0.23 + 0.36 * stemGrowth;
  float stemWidth = (0.105 + 0.019 * cos(sitePhase)) * (0.84 + 0.16 * stemGrowth);
  float crystalLength = stemLength;
  float width = stemWidth;
  vec3 localCenter = vec3(0.0, stemLength * 0.5, 0.0);
  vec3 localAxis = vec3(0.0, 1.0, 0.0);
  if (tier > 0.5) {
    float daughterPhase = sitePhase + tier * 1.91;
    float daughterGrowth = 0.5 + 0.5 * sin(phase * (0.73 + 0.041 * tier) + daughterPhase
                                          + 0.19 * sin(phase * 0.39 + site));
    crystalLength = tier < 1.5 ? 0.14 + 0.35 * daughterGrowth : 0.12 + 0.25 * daughterGrowth;
    width = (tier < 1.5 ? 0.066 : 0.053) * (0.85 + 0.27 * daughterGrowth);
    float azimuth = site * 0.618 + tier * 2.47 + 0.21 * sin(phase * 0.51 + daughterPhase);
    float inclination = 0.25 + 0.13 * sin(phase * 0.59 + daughterPhase);
    localAxis = normalize(vec3(inclination * cos(azimuth), 1.0, inclination * sin(azimuth)));
    // The root lies inside the current parent prism, below its shoulder.
    // It therefore follows its parent's growth instead of floating away.
    float attachment = tier < 1.5 ? 0.30 : 0.52;
    localCenter = vec3(stemWidth * 0.52 * cos(azimuth), stemLength * attachment,
                       stemWidth * 0.52 * sin(azimuth)) + localAxis * crystalLength * 0.5;
  }
  float height = crystalLength * 0.5;
  float shoulder = height * (0.60 + 0.09 * sin(phase * 0.61 + sitePhase + tier * 1.4));
  vec3 point = polyPrimitive(direction, layer, 4.0, vec3(width, height, width),
                              vec4(shoulder, 0.0, 0.0, 0.0));
  point.xz = rotate(point.xz, site * 0.37 + tier * 0.53 + 0.17 * sin(phase * 0.49 + sitePhase));
  point = localCenter + polyRadialFrame(point, localAxis);
  return anchor + polyRadialFrame(point, axis);
}

`;
