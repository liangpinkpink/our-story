(function () {
  const space = document.getElementById("space");
  const world = document.getElementById("world");
  const musicButton = document.getElementById("musicButton");
  const backgroundMusic = document.getElementById("backgroundMusic");
  const enterOverlay = document.getElementById("enterOverlay");
  const enterButton = document.getElementById("enterButton");
  const shuffleButton = document.getElementById("shuffleButton");
  const driftButton = document.getElementById("driftButton");
  const countLabel = document.getElementById("photoCount");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const closeLightbox = document.getElementById("closeLightbox");

  const CHUNK_SIZE = 1180;
  const RENDER_DISTANCE = 2;
  const FADE_MARGIN = 2;
  const ITEMS_PER_CHUNK = 1;
  const FOCAL_LENGTH = 960;
  const NEAR = 180;
  const FAR = 4700;
  const MAX_VEL = 118;
  const VEL_LERP = 0.3;
  const VEL_DECAY = 0.89;
  const DRAG_FORCE = 0.12;
  const WHEEL_FORCE = 0.074;
  const PINCH_ZOOM_FORCE = 0.42;

  const state = {
    camera: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    targetVel: { x: 0, y: 0, z: 0 },
    drift: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    dragging: false,
    lastX: 0,
    lastY: 0,
    moved: 0,
    pointerId: null,
    pressedPhoto: null,
    float: true,
    width: window.innerWidth,
    height: window.innerHeight,
    chunkKey: "",
    seed: 0
  };

  let photos = [];
  let cards = [];
  let rafId = 0;
  let musicUnavailable = false;
  const activePointers = new Map();
  const pinch = {
    active: false,
    distance: 0,
    centerX: 0,
    centerY: 0
  };

  function seededRandom(seed) {
    const value = Math.sin(seed * 9283.731) * 10000;
    return value - Math.floor(value);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(1, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function isMobileView() {
    return state.width <= 760 || window.matchMedia("(pointer: coarse)").matches;
  }

  function getRenderProfile() {
    const mobile = isMobileView();
    return {
      mobile,
      renderDistance: mobile ? 2 : RENDER_DISTANCE,
      fadeMargin: mobile ? 0 : FADE_MARGIN,
      itemsPerChunk: mobile ? 2 : ITEMS_PER_CHUNK,
      far: mobile ? 4300 : FAR,
      near: mobile ? 150 : NEAR,
      nearFade: mobile ? 520 : 300,
      farFadeStart: mobile ? 1350 : 1850,
      farFadeRange: mobile ? 2500 : 2300,
      maxWidthRatio: mobile ? 0.5 : 0.34,
      depthContrast: mobile ? 1.55 : 1.28
    };
  }

  function softCap(value, max) {
    const ratio = value / Math.max(0.001, max);
    return value / Math.pow(1 + Math.pow(ratio, 4), 0.25);
  }

  function initialPhotos() {
    const manifest = Array.isArray(window.WEDDING_PHOTOS) ? window.WEDDING_PHOTOS : [];
    if (manifest.length) {
      return manifest.map((item, index) => ({
        src: item.src,
        title: item.title || "Photo " + String(index + 1).padStart(2, "0")
      }));
    }

    return Array.from({ length: 32 }, (_, index) => {
      const hue = Math.round(20 + seededRandom(index + 1) * 210);
      const second = Math.round(20 + seededRandom(index + 3) * 210);
      const svg = [
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 820'>",
        "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>",
        "<stop offset='0' stop-color='hsl(" + hue + " 76% 68%)'/>",
        "<stop offset='0.62' stop-color='hsl(" + second + " 44% 34%)'/>",
        "<stop offset='1' stop-color='hsl(220 30% 8%)'/>",
        "</linearGradient></defs><rect width='1200' height='820' fill='url(#g)'/>",
        "<text x='70' y='720' font-size='82' font-family='system-ui' font-weight='600' fill='rgba(255,255,255,.86)'>",
        String(index + 1).padStart(2, "0"),
        "</text></svg>"
      ].join("");
      return {
        src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
        title: "Photo " + String(index + 1).padStart(2, "0")
      };
    });
  }

  function chunkDistance(dx, dy, dz) {
    return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  }

  function makePlane(cx, cy, cz, item) {
    const seed = hashString(cx + "," + cy + "," + cz + "," + item + "," + state.seed);
    const r = (n) => seededRandom(seed + n * 101);
    const sidePadding = CHUNK_SIZE * 0.2;
    const size = 250 + r(6) * 260;

    return {
      id: cx + ":" + cy + ":" + cz + ":" + item,
      x: cx * CHUNK_SIZE + sidePadding + r(1) * (CHUNK_SIZE - sidePadding * 2),
      y: cy * CHUNK_SIZE + sidePadding + r(2) * (CHUNK_SIZE - sidePadding * 2),
      z: cz * CHUNK_SIZE + sidePadding + r(3) * (CHUNK_SIZE - sidePadding * 2),
      width: size,
      rotate: (r(4) - 0.5) * 2.4,
      phase: r(5) * Math.PI * 2,
      mediaIndex: Math.floor(r(7) * 1000000)
    };
  }

  function makeCard(plane) {
    const card = document.createElement("button");
    const image = document.createElement("img");
    const photo = photos[plane.mediaIndex % photos.length];

    card.className = "photo-card";
    card.type = "button";
    card.setAttribute("aria-label", "打开 " + photo.title);
    card.style.width = plane.width.toFixed(0) + "px";
    card._plane = plane;
    card._photo = photo;
    card._opacity = 0;
    card._loaded = false;
    card._loading = false;

    image.alt = photo.title;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => {
      card._loaded = true;
      card.classList.add("is-loaded");
    });
    card.appendChild(image);
    card._image = image;

    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.moved < 8) openPhoto(card._photo);
    });

    return card;
  }

  function ensureImageLoading(card) {
    if (card._loaded || card._loading || card._image.getAttribute("src")) return;
    card._loading = true;
    card._image.src = card._photo.src;
  }

  function updateChunks(force) {
    const cx = Math.floor(state.camera.x / CHUNK_SIZE);
    const cy = Math.floor(state.camera.y / CHUNK_SIZE);
    const cz = Math.floor(state.camera.z / CHUNK_SIZE);
    const profile = getRenderProfile();
    const key = [
      cx,
      cy,
      cz,
      state.seed,
      profile.renderDistance,
      profile.fadeMargin,
      profile.itemsPerChunk
    ].join(",");

    if (!force && key === state.chunkKey) return;
    state.chunkKey = key;

    const maxDist = profile.renderDistance + profile.fadeMargin;
    const planes = [];

    for (let dx = -maxDist; dx <= maxDist; dx += 1) {
      for (let dy = -maxDist; dy <= maxDist; dy += 1) {
        for (let dz = 0; dz <= maxDist + 1; dz += 1) {
          const dist = chunkDistance(dx, dy, dz);
          if (dist > maxDist) continue;
          for (let item = 0; item < profile.itemsPerChunk; item += 1) {
            const plane = makePlane(cx + dx, cy + dy, cz + dz, item);
            plane.chunkDist = dist;
            planes.push(plane);
          }
        }
      }
    }

    const existing = new Map(cards.map((card) => [card._plane.id, card]));
    const nextIds = new Set();
    const nextCards = planes.map((plane) => {
      const current = existing.get(plane.id);
      nextIds.add(plane.id);
      if (current) {
        current._plane = plane;
        return current;
      }
      return makeCard(plane);
    });

    cards.forEach((card) => {
      if (!nextIds.has(card._plane.id)) {
        card.remove();
      }
    });

    nextCards.forEach((card) => {
      if (!card.parentNode) {
        world.appendChild(card);
      }
    });

    cards = nextCards;
    countLabel.textContent = String(photos.length);
  }

  function renderCards() {
    const time = performance.now();
    const centerX = state.width / 2;
    const centerY = state.height / 2;
    const profile = getRenderProfile();

    cards.forEach((card) => {
      const plane = card._plane;
      const floatAmount = state.float ? clamp((plane.z - state.camera.z) / profile.far, 0.12, 1) : 0;
      const px = plane.x + Math.cos(time * 0.000032 + plane.phase) * 18 * floatAmount;
      const py = plane.y + Math.sin(time * 0.000028 + plane.phase) * 18 * floatAmount;
      const dx = px - state.camera.x - state.drift.x;
      const dy = py - state.camera.y - state.drift.y;
      const depth = plane.z - state.camera.z;

      if (depth < profile.near || depth > profile.far) {
        card._opacity = lerp(card._opacity || 0, 0, 0.075);
        card.style.opacity = card._opacity.toFixed(3);
        card.style.pointerEvents = "none";
        return;
      }

      const rawScale = FOCAL_LENGTH / depth;
      const maxProjectedWidth = state.width * profile.maxWidthRatio;
      const depthProgress = clamp((depth - profile.near) / Math.max(1, profile.far - profile.near), 0, 1);
      const distanceScale = 1 - Math.pow(depthProgress, 1.15) * (profile.mobile ? 0.32 : 0.22);
      const scale = softCap(rawScale * distanceScale, maxProjectedWidth / plane.width);
      const screenX = centerX + dx * scale;
      const screenY = centerY + dy * scale;
      const edgeFade = Math.max(
        Math.abs(screenX - centerX) / (state.width * 0.74),
        Math.abs(screenY - centerY) / (state.height * 0.74)
      );
      const nearFade = smoothstep(profile.near, profile.near + profile.nearFade, depth);
      const farFade = Math.pow(
        1 - clamp((depth - profile.farFadeStart) / profile.farFadeRange, 0, 0.98),
        1.7
      );
      const depthFade = Math.min(nearFade, farFade);
      const depthShade = Math.pow(1 - depthProgress * 0.84, profile.depthContrast);
      const chunkFade =
        plane.chunkDist <= profile.renderDistance
          ? 1
          : 1 - clamp((plane.chunkDist - profile.renderDistance) / Math.max(profile.fadeMargin, 0.001), 0, 1);
      const targetOpacity = clamp((1.16 - edgeFade) * depthFade * depthShade * chunkFade * 0.98, 0, 1);
      if (targetOpacity > 0.002) {
        ensureImageLoading(card);
      }
      const visibleTarget = card._loaded ? targetOpacity : 0;
      const fadeEase = visibleTarget > (card._opacity || 0) ? 0.055 : 0.08;
      const opacity = lerp(card._opacity || 0, visibleTarget, fadeEase);
      const blur =
        profile.mobile
          ? clamp((depth - 1450) / 900, 0, 2.6)
          : clamp((depth - 1500) / 560, 0, 6.4);
      const brightness = 0.42 + depthShade * 0.54 + clamp(scale, 0, 1.2) * 0.1;
      const contrast = 0.88 + depthShade * 0.16;

      card._opacity = opacity;
      card.style.opacity = opacity.toFixed(3);
      card.style.pointerEvents = opacity > 0.16 ? "auto" : "none";
      card.style.zIndex = String(Math.round(100000 - depth));
      card.style.borderColor = "rgba(245, 241, 232, " + (0.08 + depthShade * 0.16).toFixed(3) + ")";
      card.style.filter = [
        "blur(" + blur.toFixed(2) + "px)",
        "brightness(" + brightness.toFixed(3) + ")",
        "contrast(" + contrast.toFixed(3) + ")"
      ].join(" ");
      card.style.transform = [
        "translate3d(" + screenX.toFixed(2) + "px, " + screenY.toFixed(2) + "px, 0)",
        "translate3d(-50%, -50%, 0)",
        "rotate(" + plane.rotate.toFixed(2) + "deg)",
        "scale(" + scale.toFixed(4) + ")"
      ].join(" ");
    });

    world.style.setProperty("--grid-x", (-state.camera.x * 0.18).toFixed(2) + "px");
    world.style.setProperty("--grid-y", (-state.camera.y * 0.18).toFixed(2) + "px");
  }

  function animate() {
    const zooming = Math.abs(state.velocity.z) > 0.08;
    const driftTarget = state.dragging
      ? { x: state.drift.x, y: state.drift.y }
      : { x: state.mouse.x * 36, y: state.mouse.y * 22 };
    const driftEase = zooming ? 0.2 : 0.11;

    if (!state.dragging) {
      state.drift.x = lerp(state.drift.x, driftTarget.x, driftEase);
      state.drift.y = lerp(state.drift.y, driftTarget.y, driftEase);
    }

    state.velocity.x = lerp(state.velocity.x, state.targetVel.x, VEL_LERP);
    state.velocity.y = lerp(state.velocity.y, state.targetVel.y, VEL_LERP);
    state.velocity.z = lerp(state.velocity.z, state.targetVel.z, VEL_LERP);

    state.camera.x += state.velocity.x;
    state.camera.y += state.velocity.y;
    state.camera.z += state.velocity.z;

    state.targetVel.x *= VEL_DECAY;
    state.targetVel.y *= VEL_DECAY;
    state.targetVel.z *= VEL_DECAY;

    updateChunks(false);
    renderCards();
    rafId = requestAnimationFrame(animate);
  }

  function openPhoto(photo) {
    lightboxImage.src = photo.src;
    lightboxImage.alt = "";
    lightboxCaption.textContent = "";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    closeLightbox.focus();
  }

  function closePhoto() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!lightbox.classList.contains("is-open")) {
        lightboxImage.removeAttribute("src");
      }
    }, 260);
  }

  function handlePointerDown(event) {
    if (lightbox.classList.contains("is-open")) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    space.setPointerCapture(event.pointerId);

    if (activePointers.size >= 2) {
      const center = getPointerCenter();
      pinch.active = true;
      pinch.distance = getPointerDistance();
      pinch.centerX = center.x;
      pinch.centerY = center.y;
      state.dragging = false;
      state.pointerId = null;
      state.pressedPhoto = null;
      state.moved = 20;
      return;
    }

    const photoCard = event.target.closest ? event.target.closest(".photo-card") : null;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.moved = 0;
    state.pressedPhoto = photoCard ? photoCard._photo : null;
  }

  function handlePointerMove(event) {
    state.mouse.x = (event.clientX / Math.max(1, state.width)) * 2 - 1;
    state.mouse.y = (event.clientY / Math.max(1, state.height)) * 2 - 1;
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (activePointers.size >= 2) {
      const currentDistance = getPointerDistance();
      const center = getPointerCenter();
      const distanceDelta = currentDistance - pinch.distance;
      const centerDx = center.x - pinch.centerX;
      const centerDy = center.y - pinch.centerY;

      state.moved += Math.abs(distanceDelta) + Math.abs(centerDx) + Math.abs(centerDy);
      state.targetVel.z = clamp(state.targetVel.z + distanceDelta * PINCH_ZOOM_FORCE, -MAX_VEL, MAX_VEL);
      state.targetVel.x = clamp(state.targetVel.x - centerDx * DRAG_FORCE * 0.75, -MAX_VEL, MAX_VEL);
      state.targetVel.y = clamp(state.targetVel.y - centerDy * DRAG_FORCE * 0.75, -MAX_VEL, MAX_VEL);

      pinch.active = true;
      pinch.distance = currentDistance;
      pinch.centerX = center.x;
      pinch.centerY = center.y;
      return;
    }

    if (!state.dragging || event.pointerId !== state.pointerId) return;

    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    state.moved += Math.abs(dx) + Math.abs(dy);
    state.lastX = event.clientX;
    state.lastY = event.clientY;

    state.targetVel.x = clamp(state.targetVel.x - dx * DRAG_FORCE, -MAX_VEL, MAX_VEL);
    state.targetVel.y = clamp(state.targetVel.y - dy * DRAG_FORCE, -MAX_VEL, MAX_VEL);
  }

  function handlePointerUp(event) {
    if (space.hasPointerCapture && space.hasPointerCapture(event.pointerId)) {
      space.releasePointerCapture(event.pointerId);
    }
    activePointers.delete(event.pointerId);

    if (activePointers.size < 2) {
      pinch.active = false;
    }

    if (event.pointerId !== state.pointerId) {
      if (activePointers.size === 1) {
        const nextPointer = activePointers.entries().next().value;
        if (nextPointer) {
          state.dragging = true;
          state.pointerId = nextPointer[0];
          state.lastX = nextPointer[1].x;
          state.lastY = nextPointer[1].y;
          state.pressedPhoto = null;
        }
      }
      return;
    }

    const shouldOpenPhoto = state.pressedPhoto && state.moved < 8;
    const photo = state.pressedPhoto;
    state.dragging = false;
    state.pointerId = null;
    state.pressedPhoto = null;
    if (shouldOpenPhoto) {
      event.preventDefault();
      openPhoto(photo);
    }
  }

  function getPointerList() {
    return Array.from(activePointers.values());
  }

  function getPointerDistance() {
    const points = getPointerList();
    if (points.length < 2) return 0;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.hypot(dx, dy);
  }

  function getPointerCenter() {
    const points = getPointerList();
    if (points.length < 2) {
      return { x: state.lastX, y: state.lastY };
    }
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    updateChunks(true);
    renderCards();
  }

  space.addEventListener("pointerdown", handlePointerDown);
  space.addEventListener("pointermove", handlePointerMove);
  space.addEventListener("pointerup", handlePointerUp);
  space.addEventListener("pointercancel", handlePointerUp);

  space.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.targetVel.z = clamp(state.targetVel.z - event.deltaY * WHEEL_FORCE, -MAX_VEL, MAX_VEL);
  }, { passive: false });

  function updateMusicButton(isPlaying) {
    musicButton.setAttribute("aria-pressed", String(isPlaying));
    musicButton.setAttribute("aria-label", isPlaying ? "暂停背景音乐" : "播放背景音乐");
    musicButton.querySelector("span").textContent = isPlaying ? "Ⅱ" : "♪";
  }

  async function playMusic() {
    if (musicUnavailable) return;
    try {
      backgroundMusic.volume = 0.42;
      if (!backgroundMusic.currentSrc) {
        backgroundMusic.load();
      }
      await backgroundMusic.play();
      updateMusicButton(true);
    } catch {
      updateMusicButton(false);
    }
  }

  musicButton.addEventListener("click", () => {
    if (musicUnavailable) {
      return;
    }

    if (backgroundMusic.paused) {
      playMusic();
    } else {
      backgroundMusic.pause();
      updateMusicButton(false);
    }
  });

  enterButton.addEventListener("click", () => {
    enterOverlay.classList.add("is-hidden");
    enterOverlay.setAttribute("aria-hidden", "true");
    playMusic();
  });

  backgroundMusic.addEventListener("error", () => {
    musicUnavailable = true;
    musicButton.disabled = true;
    musicButton.setAttribute("aria-label", "背景音乐文件缺失");
    musicButton.querySelector("span").textContent = "♪";
  });

  backgroundMusic.addEventListener("ended", () => updateMusicButton(false));
  backgroundMusic.addEventListener("pause", () => updateMusicButton(false));
  backgroundMusic.addEventListener("play", () => updateMusicButton(true));

  shuffleButton.addEventListener("click", () => {
    state.seed += 1;
    updateChunks(true);
  });

  driftButton.addEventListener("click", () => {
    state.float = !state.float;
    driftButton.setAttribute("aria-pressed", String(state.float));
  });

  closeLightbox.addEventListener("click", closePhoto);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closePhoto();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePhoto();
    if (event.key === "ArrowLeft" || event.key === "a") state.targetVel.x -= 3.8;
    if (event.key === "ArrowRight" || event.key === "d") state.targetVel.x += 3.8;
    if (event.key === "ArrowUp" || event.key === "w") state.targetVel.y -= 3.8;
    if (event.key === "ArrowDown" || event.key === "s") state.targetVel.y += 3.8;
    if (event.key === "q") state.targetVel.z -= 3.8;
    if (event.key === "e") state.targetVel.z += 3.8;
  });

  window.addEventListener("resize", resize);

  photos = initialPhotos();
  updateChunks(true);
  cancelAnimationFrame(rafId);
  animate();
}());
