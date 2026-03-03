export function FilterGroup({ title, children, className = '' }) {
  return (
    <section className={`or-filter-group ${className}`.trim()}>
      {title ? <h3 className="or-filter-group__title">{title}</h3> : null}
      <div className="or-filter-group__body">{children}</div>
    </section>
  );
}

export function FilterField({ label, children, className = '' }) {
  return (
    <label className={`or-filter-field ${className}`.trim()}>
      <span className="or-filter-field__label">{label}</span>
      {children}
    </label>
  );
}

export function SelectField({ label, className = '', children, ...props }) {
  return (
    <FilterField label={label} className={className}>
      <select className="or-select" {...props}>
        {children}
      </select>
    </FilterField>
  );
}

export function InputField({ label, className = '', ...props }) {
  return (
    <FilterField label={label} className={className}>
      <input className="or-input" {...props} />
    </FilterField>
  );
}
