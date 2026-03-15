const pageDependencies = {
  Radar: ['/api/radar', '/api/market-breadth', '/api/sector-rotation'],
  Scanner: ['/api/scanner'],
  OpportunityStream: ['/api/opportunities', '/api/catalysts'],
  Charts: ['/api/chart-data'],
  Cockpit: ['/api/signals', '/api/ticker-tape'],
  StrategyEdge: ['/api/signals', '/api/trade-setups'],
  LearningDashboard: ['/api/signals', '/api/intelligence-feed'],
  SystemDiagnostics: ['/api/system/diagnostics', '/api/system/health'],
};

function endpointHealthy(endpointResult) {
  return Boolean(endpointResult && endpointResult.ok);
}

function endpointHasData(endpointResult) {
  if (!endpointResult) return false;
  if (Array.isArray(endpointResult.parsedData)) return endpointResult.parsedData.length > 0;
  if (Array.isArray(endpointResult.primaryArray)) return endpointResult.primaryArray.length > 0;
  return false;
}

function testPages(endpointResults) {
  const byEndpoint = new Map(endpointResults.map((result) => [result.endpoint, result]));

  return Object.entries(pageDependencies).map(([page, deps]) => {
    const dependencyResults = deps.map((endpoint) => ({
      endpoint,
      result: byEndpoint.get(endpoint),
    }));

    const failed = dependencyResults.filter(({ result }) => !endpointHealthy(result));
    const empty = dependencyResults.filter(({ result }) => endpointHealthy(result) && !endpointHasData(result));

    let status = 'OK';
    if (failed.length > 0) {
      status = 'BROKEN';
    } else if (empty.length > 0) {
      status = 'PARTIAL';
    }

    return {
      page,
      status,
      dependencies: deps,
      failures: failed.map(({ endpoint, result }) => ({ endpoint, status: result?.status ?? 'MISSING' })),
      emptyDataDependencies: empty.map(({ endpoint }) => endpoint),
    };
  });
}

module.exports = {
  pageDependencies,
  testPages,
};
