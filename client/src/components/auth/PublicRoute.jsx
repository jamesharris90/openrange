import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (isAuthenticated) return <Navigate to="/watchlist" replace />;

  return children;
}
