export default function Table({ className = '', children, ...props }) {
  return (
    <div className={`or-table overflow-auto ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
