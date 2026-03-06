export default function ButtonSecondary({ className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`or-button or-button-secondary ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
