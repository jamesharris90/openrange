export default function ButtonGhost({ className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`or-button or-button-ghost ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
