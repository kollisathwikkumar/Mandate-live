export function SidebarAmbient({ placement }: { placement: 'top' | 'gap' }) {
  return <div className={`sidebar-ambient-field sidebar-ambient-${placement}`} aria-hidden="true" />;
}
