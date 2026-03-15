import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected UI error' };
  }

  componentDidCatch(error, info) {
    console.error('Global ErrorBoundary caught', error, info);
  }

  render() {
    if (this.state.hasError) {
      const {
        inline = false,
        fallback = null,
        title = 'OpenRange encountered an error',
        description = 'A runtime error interrupted rendering.',
      } = this.props;

      if (fallback) {
        return typeof fallback === 'function'
          ? fallback({ error: this.state.error, reset: () => this.setState({ hasError: false, message: '' }) })
          : fallback;
      }

      if (inline) {
        return (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-amber-50/90">{this.state.message || description}</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center rounded-md border border-amber-300/60 px-3 py-1.5 text-xs font-medium"
              onClick={() => this.setState({ hasError: false, message: '' })}
            >
              Retry panel
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-slate-300">{this.state.message || description}</p>
            <button
              type="button"
              className="mt-5 inline-flex items-center rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
