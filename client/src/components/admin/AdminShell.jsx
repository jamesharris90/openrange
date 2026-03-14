import { memo, useEffect, useState } from 'react';
import AdminHeader from './AdminHeader';
import AdminSidebar from './AdminSidebar';

function AdminShell({ title, subtitle, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen">
        <AdminSidebar isOpen={sidebarOpen} onNavigate={closeSidebar} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <AdminHeader
            title={title}
            subtitle={subtitle}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
          />

          <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>

      {sidebarOpen ? (
        <button
          type="button"
          onClick={closeSidebar}
          aria-label="Close admin navigation"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      ) : null}
    </div>
  );
}

export default memo(AdminShell);
