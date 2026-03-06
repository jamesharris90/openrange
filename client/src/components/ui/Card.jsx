export default function Card({ as: Tag = 'section', className = '', children, ...props }) {
  return (
    <Tag className={`or-card-ui card or-card ${className}`.trim()} {...props}>
      {children}
    </Tag>
  );
}
