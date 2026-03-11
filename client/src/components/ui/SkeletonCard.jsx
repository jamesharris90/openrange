export default function SkeletonCard({ lines = 3, className = '' }) {
  return (
    <div className={`or-card-ui ${className}`.trim()}>
      <div className="or-skeleton mb-3 h-4 w-28 rounded" />
      {Array.from({ length: lines })?.map((_, idx) => (
        <div key={`s-line-${idx}`} className="or-skeleton mb-2 h-3 w-full rounded last:mb-0" />
      ))}
    </div>
  );
}
