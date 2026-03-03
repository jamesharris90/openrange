export default function ChartContainer({ children }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}