import { Navigate } from 'react-router-dom';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';

export default function FeatureGateRoute({ featureKey, children }) {
  const { loading, hasFeature, role } = useFeatureAccess();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (role === 'admin' || hasFeature(featureKey)) {
    return children;
  }

  return <Navigate to="/access-denied" replace />;
}
