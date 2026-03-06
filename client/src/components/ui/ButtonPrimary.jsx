export default function ButtonPrimary({ className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`or-button or-button-primary ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
