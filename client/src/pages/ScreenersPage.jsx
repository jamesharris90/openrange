import React from 'react';
import { NavLink } from 'react-router-dom';
import { Flame, Rocket, BarChart2, Target, Newspaper } from 'lucide-react';

const CARDS = [
  {
    title: 'Small Cap Momentum',
    description: 'High RVOL, sub-$30 names with 5%+ intraday momentum and liquid floats.',
    icon: <Rocket size={18} />,
    link: '/advanced-screener',
  },
  {
    title: 'Day Gainers',
    description: 'Large/mid-cap leaders with strong relative volume and clean trends.',
    icon: <Flame size={18} />,
    link: '/advanced-screener',
  },
  {
    title: 'Value & Quality',
    description: 'Large-cap names with solid balance sheets and reasonable valuations.',
    icon: <BarChart2 size={18} />,
    link: '/advanced-screener',
  },
  {
    title: 'News Scanner',
    description: 'Breaking catalysts, sentiment scores, and instant watchlist adds.',
    icon: <Newspaper size={18} />,
    link: '/news-scanner',
  },
  {
    title: 'Custom Filters',
    description: 'Build your own filter set and export to CSV directly.',
    icon: <Target size={18} />,
    link: '/advanced-screener',
  },
];

export default function ScreenersPage() {
  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Market Screeners</h2>
        <p className="muted" style={{ marginTop: 4 }}>Pick a preset or jump into the advanced screener. All results support watchlist sync and CSV export.</p>
      </div>

      <div className="panel">
        <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {CARDS.map(card => (
            <div key={card.title} className="panel" style={{ padding: 16, border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                {card.icon}
                <h3 style={{ margin: 0 }}>{card.title}</h3>
              </div>
              <p className="muted" style={{ margin: 0, marginBottom: 10 }}>{card.description}</p>
              <NavLink className="btn-primary btn-sm" to={card.link}>Open</NavLink>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
