"use client";
// A 3D film rangefinder, modelled in code with three.js (no downloaded model): satin metal top and
// bottom plates, pebbled leatherette, a knurled lens with a coated (iridescent) front element, a
// date-stamp-orange shutter button. It turns toward the pointer, floats, and now and then the shutter
// fires: the button dips and the flash window lights up (onFlash lets the page add a screen flash).
//
// three.js is loaded only when this mounts (auth and landing pages), paused when off-screen or the tab
// is hidden, and drawn once (no animation) with prefers-reduced-motion.
import { useEffect, useRef, useState } from "react";

type Props = { className?: string; onFlash?: () => void; interval?: number };

export function Camera3D({ className, onFlash, interval = 7000 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const flashRef = useRef(onFlash);
  flashRef.current = onFlash;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed || !host.current) return;
      const el = host.current;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch { setFailed(true); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block";

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      cam.position.set(0, 0.6, 11);
      cam.lookAt(0, 0, 0);

      // ---------- procedural textures (canvas): leather pebbling, knurling, engraving, shadow ----------
      const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, color = false) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        draw(c.getContext("2d")!);
        const t = new THREE.CanvasTexture(c);
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      };
      const leather = canvasTex(512, 512, (g) => {
        g.fillStyle = "#808080"; g.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 9000; i++) { const v = 90 + Math.random() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 1.5 + Math.random() * 2.5, 0, 7); g.fill(); }
      });
      leather.wrapS = leather.wrapT = THREE.RepeatWrapping; leather.repeat.set(3, 2);
      const knurl = canvasTex(512, 16, (g) => { for (let x = 0; x < 512; x += 8) { g.fillStyle = "#fff"; g.fillRect(x, 0, 4, 16); g.fillStyle = "#000"; g.fillRect(x + 4, 0, 4, 16); } });
      knurl.wrapS = knurl.wrapT = THREE.RepeatWrapping;
      const engraving = canvasTex(512, 96, (g) => {
        g.clearRect(0, 0, 512, 96);
        g.font = "700 64px Archivo, 'Helvetica Neue', Arial, sans-serif"; g.fillStyle = "rgba(30,32,38,0.85)"; g.textBaseline = "middle";
        g.fillText("GLIMPSE", 8, 50); g.fillStyle = "#f2691b"; g.beginPath(); g.arc(300, 64, 9, 0, 7); g.fill();
      }, true);
      const shadowTex = canvasTex(256, 256, (g) => {
        const r = g.createRadialGradient(128, 128, 10, 128, 128, 128);
        r.addColorStop(0, "rgba(0,0,0,0.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 256, 256);
      });

      // ---------- materials ----------
      const metal = new THREE.MeshPhysicalMaterial({ color: 0xd3d6db, metalness: 1, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.25 });
      const darkMetal = new THREE.MeshPhysicalMaterial({ color: 0x1b1c20, metalness: 0.9, roughness: 0.38, clearcoat: 0.5 });
      const leatherMat = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.92, bumpMap: leather, bumpScale: 1.4 });
      const knurlMetal = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.35, bumpMap: knurl, bumpScale: 2 });
      const knurlBlack = new THREE.MeshPhysicalMaterial({ color: 0x18191c, metalness: 0.7, roughness: 0.45, bumpMap: knurl, bumpScale: 2 });
      const orange = new THREE.MeshPhysicalMaterial({ color: 0xf2691b, metalness: 0.3, roughness: 0.25, clearcoat: 1, emissive: 0xf2691b, emissiveIntensity: 0.15 });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1426, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], envMapIntensity: 2 });
      const windowGlass = new THREE.MeshPhysicalMaterial({ color: 0x0c1220, metalness: 0.1, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 });
      const flashMat = new THREE.MeshPhysicalMaterial({ color: 0xe9ecf2, roughness: 0.55, transmission: 0, emissive: 0xffffff, emissiveIntensity: 0 });

      const group = new THREE.Group();
      scene.add(group);
      type Geo = ConstructorParameters<typeof THREE.Mesh>[0];
      const add = (geo: Geo, mat: InstanceType<typeof THREE.Material>, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); group.add(m); return m;
      };
      const RB = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 5, r);
      const cyl = (r: number, h: number, seg = 64) => new THREE.CylinderGeometry(r, r, h, seg);
      const front = 0.62;

      // body: leatherette band between satin metal plates
      add(RB(4.4, 1.86, 1.24, 0.14), leatherMat);
      add(RB(4.52, 0.44, 1.34, 0.12), metal, 0, 1.12);
      add(RB(4.52, 0.38, 1.34, 0.12), metal, 0, -1.1);
      // engraving on the top plate's front face
      const eng = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.24), new THREE.MeshBasicMaterial({ map: engraving, transparent: true }));
      eng.position.set(-1.25, 1.12, front + 0.051); group.add(eng);

      // lens: mount, focus ring (knurled metal), barrel (knurled black), front ring, orange accent, coated glass
      const lx = 0.2, ly = -0.05;
      add(cyl(1.0, 0.16), metal, lx, ly, front + 0.08, Math.PI / 2);
      add(cyl(0.9, 0.3), knurlMetal, lx, ly, front + 0.3, Math.PI / 2);
      add(cyl(0.8, 0.5), knurlBlack, lx, ly, front + 0.7, Math.PI / 2);
      add(cyl(0.84, 0.1), darkMetal, lx, ly, front + 0.98, Math.PI / 2);
      add(new THREE.TorusGeometry(0.7, 0.018, 12, 96), orange, lx, ly, front + 1.035);
      add(new THREE.CircleGeometry(0.68, 64), new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.6 }), lx, ly, front + 1.03);
      const lens = new THREE.SphereGeometry(1.2, 64, 32, 0, Math.PI * 2, 0, 0.6);
      const element = add(lens, glass, lx, ly, front + 0.06, Math.PI / 2);
      element.scale.set(1, 1, 1);
      add(new THREE.TorusGeometry(0.4, 0.012, 8, 64), new THREE.MeshPhysicalMaterial({ color: 0x9fb4ff, metalness: 1, roughness: 0.2 }), lx, ly, front + 0.98);

      // windows: viewfinder (left), flash (right), rangefinder dot
      add(RB(0.86, 0.5, 0.08, 0.06), metal, -1.5, 0.48, front + 0.02);
      add(RB(0.72, 0.38, 0.06, 0.05), windowGlass, -1.5, 0.48, front + 0.06);
      add(RB(0.86, 0.5, 0.08, 0.06), metal, 1.62, 0.48, front + 0.02);
      const flash = add(RB(0.72, 0.38, 0.06, 0.05), flashMat, 1.62, 0.48, front + 0.06);
      add(cyl(0.12, 0.06, 32), windowGlass, -0.75, 0.62, front + 0.03, Math.PI / 2);

      // top controls: shutter button (orange), speed dial, rewind knob, hot shoe, advance lever
      const shutter = add(cyl(0.15, 0.14), orange, 1.45, 1.42, 0.05);
      add(cyl(0.24, 0.06), metal, 1.45, 1.36, 0.05);
      add(cyl(0.38, 0.16), knurlMetal, 0.75, 1.42, -0.05);
      add(cyl(0.3, 0.12), darkMetal, 0.75, 1.52, -0.05);
      add(cyl(0.32, 0.22), knurlMetal, -1.55, 1.45, -0.02);
      add(RB(0.62, 0.08, 0.5, 0.02), metal, -0.15, 1.38, 0);
      add(RB(0.9, 0.06, 0.16, 0.03), darkMetal, 1.85, 1.41, -0.38, 0, 0.5);
      // strap lugs
      add(new THREE.TorusGeometry(0.1, 0.03, 12, 24), metal, -2.3, 0.78, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.1, 0.03, 12, 24), metal, 2.3, 0.78, 0, 0, Math.PI / 2);

      // soft contact shadow under it
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.85; scene.add(shadow);

      // lights: warm key, cool fill, orange rim (the date-stamp colour) from behind
      const key = new THREE.DirectionalLight(0xfff1e2, 2.2); key.position.set(4, 5, 6); scene.add(key);
      const fill = new THREE.DirectionalLight(0xbcd2ff, 0.7); fill.position.set(-6, 1, 4); scene.add(fill);
      const rim = new THREE.DirectionalLight(0xff7a2e, 2.4); rim.position.set(-3, 3, -6); scene.add(rim);
      scene.add(new THREE.AmbientLight(0xffffff, 0.15));
      group.rotation.set(0.12, -0.45, 0);

      // ---------- sizing, pointer, visibility ----------
      const size = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.position.z = w / h < 1 ? 15 : 11; // portrait boxes: step back so it fits
        cam.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(size); ro.observe(el); size();
      const target = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => { target.x = (e.clientX / window.innerWidth - 0.5) * 2; target.y = (e.clientY / window.innerHeight - 0.5) * 2; };
      window.addEventListener("pointermove", onMove);
      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.01 });
      io.observe(el);

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const t0 = performance.now();
      let lastShot = t0, raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        const t = (performance.now() - t0) / 1000;
        group.rotation.y += (-0.45 + Math.sin(t * 0.35) * 0.32 + target.x * 0.35 - group.rotation.y) * 0.05;
        group.rotation.x += (0.12 + target.y * 0.12 - group.rotation.x) * 0.05;
        group.position.y = Math.sin(t * 0.9) * 0.08;
        shadow.scale.setScalar(1 - group.position.y * 0.6);
        // the shutter: button dips, flash window glows, page can flash the screen
        const since = performance.now() - lastShot;
        if (since > interval) { lastShot = performance.now(); flashRef.current?.(); }
        const press = since < 140 ? 1 : 0;
        shutter.position.y = 1.42 - press * 0.05;
        flashMat.emissiveIntensity = Math.max(0, 4 * (1 - since / 260));
        renderer.render(scene, cam);
      };
      if (reduce) renderer.render(scene, cam); else tick();

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener("pointermove", onMove);
        scene.traverse((o) => { const m = o as InstanceType<typeof THREE.Mesh>; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });
        [leather, knurl, engraving, shadowTex].forEach((x) => x.dispose());
        pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    })().catch(() => setFailed(true));
    return () => { disposed = true; cleanup(); };
  }, [interval]);

  return (
    <div ref={host} className={className} aria-hidden>
      {failed && <div className="grid h-full place-items-center text-[64px]" aria-hidden>📷</div>}
    </div>
  );
}
