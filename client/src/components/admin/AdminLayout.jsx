import AdminShell from './AdminShell';

export default function AdminLayout({ title, section, subtitle, children }) {
  return (
    <AdminShell title={title || section || 'Admin'} subtitle={subtitle || ''}>
      {children}
    </AdminShell>
  );
}
