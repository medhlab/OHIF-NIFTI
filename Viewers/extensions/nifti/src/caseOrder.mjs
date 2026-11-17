const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Copy the list, retaining row identities used by selection and prefetch updates.
export function naturalCaseOrder(rows = []) {
  return [...rows].sort((a, b) => names.compare(a.name || '', b.name || ''));
}
