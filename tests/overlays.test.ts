import { describe, it, expect } from 'vitest';
import { OverlayManager } from '../src/ui/overlays';
describe('overlay manager', () => {
  it('draws contextual overlays only while their context lives and clears them on exit', () => {
    const st = { mode: false, dialog: false, analyze: false, control: false }; let zone = 1, prev = 1;
    const ov = new OverlayManager({ mode: () => st.mode, dialog: () => st.dialog, analyze: () => st.analyze, control: () => st.control })
      .register({ id: 'zone', ctx: 'dialog', label: 'zone', clear: () => (zone = 0) }, { id: 'preview', ctx: 'mode', label: 'p', clear: () => (prev = 0) });
    ov.sync(); expect(ov.on('zone')).toBe(false); expect(ov.on('unknown')).toBe(true);
    st.dialog = true; ov.sync(); expect(ov.on('zone')).toBe(true); expect(zone).toBe(1);
    st.mode = true; ov.sync(); st.dialog = false; expect(ov.sync()).toEqual(['zone']); expect(zone).toBe(0); expect(prev).toBe(1);
    st.mode = false; expect(ov.sync()).toEqual(['preview']); expect(prev).toBe(0); expect(ov.sync()).toEqual([]);
  });
});
