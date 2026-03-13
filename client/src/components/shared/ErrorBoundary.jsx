import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { logUIError } from '../../utils/logUIError';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
    logUIError({
      message: error?.message || 'Unknown UI error',
      stack: error?.stack || null,
      componentStack: info?.componentStack || null,
      pathname: window.location?.pathname || null,
      userAgent: window.navigator?.userAgent || null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <AlertTriangle size={32} />
          <h3>Something went wrong</h3>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button className="btn-primary" onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
