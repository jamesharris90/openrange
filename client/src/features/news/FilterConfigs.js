export const newsFilterSections = {
  quick: {
    id: 'quick',
    title: 'Ticker & Score',
    fields: [
      { id: 'tickersInput', label: 'Tickers', type: 'text' },
      { id: 'scoreMin', label: 'Score Min', type: 'number' },
      { id: 'scoreMax', label: 'Score Max', type: 'number' },
    ],
  },
};

export function buildNewsFilterDefaults() {
  return {
    tickersInput: '',
    scoreMin: null,
    scoreMax: null,
  };
}
