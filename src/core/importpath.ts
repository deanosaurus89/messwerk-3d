/** Home → Import: IGES/STEP (optionally gzipped) become a CAD reference, not the measured mesh. */
export function importTarget(name: string): 'reference' | 'mesh' {
  const base = name.toLowerCase().replace(/\.gz$/, '');
  const ext = base.split('.').pop() ?? '';
  return ext === 'stp' || ext === 'step' || ext === 'igs' || ext === 'iges' ? 'reference' : 'mesh';
}
