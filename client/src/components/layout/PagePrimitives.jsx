import React from 'react';

export function PageContainer({ className = '', children }) {
  return <div className={`page-container page-stack ${className}`.trim()}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <header className={`page-header page-header--standard ${className}`.trim()}>
      <div>
        <h2 className="m-0">{title}</h2>
        {subtitle ? <p className="muted mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function PageSection({ className = '', children }) {
  return <section className={`panel page-section ${className}`.trim()}>{children}</section>;
}

export function PageGrid({ columns = 'cards', className = '', children }) {
  const modeClass = columns === 'two-col' ? 'layout-grid-two-col' : columns === 'cards' ? 'layout-grid-cards' : '';
  return <div className={`${modeClass} ${className}`.trim()}>{children}</div>;
}
