export function v2Snapshot(overrides = {}) {
  const daily = Array.from({ length: 28 }, (_, index) => ({
    date: new Date(Date.parse('2026-09-05T00:00:00Z') + index * 86400000).toISOString().slice(0, 10),
    netQty: index === 27 ? 9 : 0, netRevenue: index === 27 ? 250000 : 0,
    canceledQty: index === 27 ? 1 : 0, returnedQty: 0,
  }));
  return { schemaVersion: 2, generatedAt: '2026-10-02T20:59:30.000Z',
    period: { start: '2026-09-26', end: '2026-10-02', timeZone: 'Asia/Seoul' },
    comparisonPeriod: { start: '2026-09-19', end: '2026-09-25', timeZone: 'Asia/Seoul' },
    trendPeriod: { start: '2026-09-05', end: '2026-10-02', timeZone: 'Asia/Seoul' },
    source: 'cafe24', status: 'ready', items: {
      'AS-26F-TEST': { productNos: [123], netQty: 9, netRevenue: 250000, canceledQty: 1,
        returnedQty: 0, rank: 1, gauge: 88, status: 'pending', reason: 'aggregate fixture',
        previousNetQty: 0, recent28NetQty: 9, daily },
    }, coverage: { complete: true, orderCount: 10, runtimePages: 4 }, ...overrides };
}
