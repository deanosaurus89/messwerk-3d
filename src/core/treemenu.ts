// Right-click actions shared by the tree (2026.0.46).
// Every object except the global coordinate system can be deleted.
// Center, Properties and transparency are present wherever they apply.
export type TreeTarget =
  | 'feature' | 'measured' | 'nominal'
  | 'data' | 'reference' | 'cad-face'
  | 'curve' | 'report' | 'csys' | 'wcs';

export type TreeAction = 'center' | 'properties' | 'opacity' | 'delete';

const FULL: TreeAction[] = ['center', 'properties', 'opacity', 'delete'];

export function treeMenuIds(target: TreeTarget): TreeAction[] {
  if (target === 'wcs') return ['center', 'properties'];
  if (target === 'report' || target === 'curve') return ['properties', 'delete'];
  if (target === 'csys') return ['center', 'properties', 'delete'];
  return FULL;
}

export function canDelete(target: TreeTarget): boolean {
  return treeMenuIds(target).includes('delete');
}
