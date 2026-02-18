export default function LoadingSpinner({ message }) {
  return (
    <div className="loading-spinner-wrap">
      <div className="loading-spinner" />
      {message && <div className="loading-spinner-msg">{message}</div>}
    </div>
  );
}
