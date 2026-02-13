import { SOURCE_COLORS } from '../../utils/constants';

export default function SourceBadge({ source }) {
  const colors = SOURCE_COLORS[source] || SOURCE_COLORS.manual;
  return (
    <span
      className="source-badge"
      style={{ background: colors.bg, color: colors.color }}
    >
      {colors.label}
    </span>
  );
}
