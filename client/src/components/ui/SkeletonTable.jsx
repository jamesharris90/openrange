export default function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            {Array.from({ length: cols })?.map((_, idx) => (
              <th key={`sh-${idx}`}><div className="or-skeleton h-3 w-16 rounded" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows })?.map((_, rIdx) => (
            <tr key={`sr-${rIdx}`}>
              {Array.from({ length: cols })?.map((_, cIdx) => (
                <td key={`sc-${rIdx}-${cIdx}`}><div className="or-skeleton h-3 w-full rounded" /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
