// Orbit replacement: pan and zoom like OrbitControls, rotate in screen space so a
// drag about the horizontal screen axis is not stopped by the polar clamp.
import * as THREE from 'three';
import { tumble } from '../core/tumble';
import type { Vec3 } from '../core/linalg';

type Listener = (e?: unknown) => void;

export class TumbleControls {
  enabled = true;
  enableDamping = false;
  screenSpacePanning = true;
  target = new THREE.Vector3();
  mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  private listeners = new Map<string, Listener[]>();
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: 'rotate' | 'pan' | 'dolly' | null = null;
  private last = { x: 0, y: 0, dist: 0 };
  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  addEventListener(type: string, fn: Listener) {
    const a = this.listeners.get(type) ?? []; a.push(fn); this.listeners.set(type, a);
  }
  removeEventListener(type: string, fn: Listener) {
    const a = this.listeners.get(type); if (a) this.listeners.set(type, a.filter((f) => f !== fn));
  }
  private emit(type: string) { for (const f of this.listeners.get(type) ?? []) f(); }
  /** Keep the camera looking at the target. Does not rebuild a spherical pose, so a tumble is not clamped back. */
  update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); }
  dispose() {
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }
  private onDown = (e: PointerEvent) => {
    if (!this.enabled || e.button === 1 && this.mouseButtons.MIDDLE !== THREE.MOUSE.PAN && this.mouseButtons.MIDDLE !== THREE.MOUSE.ROTATE) { /* still track */ }
    if (!this.enabled) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      const pan = e.button === 1 || e.button === 2;
      this.mode = pan ? 'pan' : 'rotate';
      this.last = { x: e.clientX, y: e.clientY, dist: 0 };
    } else if (this.pointers.size === 2) {
      this.mode = 'dolly';
      this.last.dist = this.span();
    }
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  };
  private span() {
    const p = [...this.pointers.values()];
    return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  }
  private mid() {
    const p = [...this.pointers.values()];
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }
  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      const dist = this.span();
      if (this.last.dist > 1 && dist > 1) this.dolly(this.last.dist / dist);
      const m = this.mid();
      if (this.last.x) this.pan(m.x - this.last.x, m.y - this.last.y);
      this.last = { x: m.x, y: m.y, dist };
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (this.mode === 'pan') this.pan(dx, dy);
    else if (this.mode === 'rotate') this.rotate(dx, dy);
  };
  private onUp = (e: PointerEvent) => {
    const had = this.mode != null;
    this.pointers.delete(e.pointerId);
    if (!this.pointers.size) {
      this.mode = null;
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      if (had) this.emit('end');
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.dolly(e.deltaY > 0 ? 1.08 : 0.92);
    this.emit('end');
  };
  private rotate(dx: number, dy: number) {
    const h = this.dom.clientHeight || 600;
    const offset = this.camera.position.clone().sub(this.target);
    const up = this.camera.up.clone();
    const r = tumble(offset.toArray() as Vec3, up.toArray() as Vec3, (2 * Math.PI * dx) / h, (2 * Math.PI * dy) / h);
    this.camera.up.set(r.up[0], r.up[1], r.up[2]);
    this.camera.position.copy(this.target).add(new THREE.Vector3(r.offset[0], r.offset[1], r.offset[2]));
    this.camera.lookAt(this.target);
  }
  private pan(dx: number, dy: number) {
    this.camera.updateMatrixWorld();
    const h = this.dom.clientHeight || 1;
    const dist = this.camera.position.distanceTo(this.target);
    const fov = (this.camera.fov * Math.PI) / 180;
    const world = 2 * Math.tan(fov / 2) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const move = right.multiplyScalar((-dx / h) * world).add(up.multiplyScalar((dy / h) * world));
    this.camera.position.add(move);
    this.target.add(move);
  }
  private dolly(scale: number) {
    const offset = this.camera.position.clone().sub(this.target).multiplyScalar(scale);
    const d = offset.length();
    if (d < 1e-4 || d > 1e7) return;
    this.camera.position.copy(this.target).add(offset);
  }
}
