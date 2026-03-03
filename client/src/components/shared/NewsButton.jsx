import React from 'react';

export default function NewsButton({
  as = 'button',
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  iconOnly = false,
  className = '',
  children,
  ...props
}) {
  const Tag = as;
  const composedClass = [
    'ns-btn',
    `ns-btn--${variant}`,
    `ns-btn--${size}`,
    iconOnly ? 'ns-btn--icon-only' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Tag className={composedClass} {...props}>
      {icon ? <span className="ns-btn__icon" aria-hidden>{icon}</span> : null}
      {children ? <span className="ns-btn__label">{children}</span> : null}
      {iconRight ? <span className="ns-btn__icon" aria-hidden>{iconRight}</span> : null}
    </Tag>
  );
}
