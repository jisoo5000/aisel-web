// Pure, credential-free rules migration. Pass the complete current rules read
// from the management console. Never save account identifiers in this module.
export function extendSalesRules(existing) {
  if (!existing || existing.rules?.['.read'] !== false || existing.rules?.['.write'] !== false) {
    throw new Error('RULES_BASELINE_UNRECOGNIZED');
  }
  const sales = existing.rules.salesPerformance;
  const current = sales?.current;
  if (!current || sales['.read'] || sales['.write']) throw new Error('RULES_BASELINE_UNRECOGNIZED');
  const machineMatch = /^auth != null && (auth\.uid === '[A-Za-z0-9_-]+') && newData\.exists\(\)$/u.exec(current['.write']);
  const ownerMatch = /^auth != null && \(auth\.uid === '[A-Za-z0-9_-]+' \|\| (\(auth\.token\.email_verified === true && auth\.token\.email === '[^'\r\n]+'\))\)$/u.exec(current['.read']);
  if (!machineMatch || !ownerMatch || !current['.read'].includes(machineMatch[1])) throw new Error('RULES_IDENTITIES_UNRECOGNIZED');
  for (const [key, value] of Object.entries(existing.rules)) {
    if (key.startsWith('$') && (value['.read'] !== `${key} !== 'salesPerformance'`
      || value['.write'] !== `${key} !== 'salesPerformance'`)) throw new Error('RULES_ANCESTOR_GRANT_UNRECOGNIZED');
  }
  const owner = `auth != null && ${ownerMatch[1]}`;
  const machine = `auth != null && ${machineMatch[1]}`;
  const read = current['.read'];
  const datePattern = '/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/';
  const codePattern = '/^AS-[A-Za-z0-9-]{1,100}$/';
  const string = (limit) => ({ '.validate': `newData.isString() && newData.val().length <= ${limit}` });
  const date = (empty = false) => ({ '.validate': `newData.isString() && (${empty ? "newData.val() === '' || " : ''}newData.val().matches(${datePattern}))` });
  const number = (nonnegative = false) => ({ '.validate': `newData.isNumber() && newData.val() >= ${nonnegative ? 0 : -9007199254740991} && newData.val() <= 9007199254740991` });
  const enumeration = (values) => ({ '.validate': values.map((v) => `newData.val() === '${v}'`).join(' || ') });
  const closed = (fields, required = []) => ({ ...(required.length ? { '.validate': `newData.hasChildren(${JSON.stringify(required)})` } : {}), ...fields, '$other': { '.validate': false } });
  const period = closed({ start: date(), end: date(), timeZone: enumeration(['Asia/Seoul']) }, ['start','end','timeZone']);
  const item = closed({ productNos: { '$index': number(true) }, netQty: number(), netRevenue: number(),
    canceledQty: number(true), returnedQty: number(true), rank: number(true), gauge: number(true),
    status: enumeration(['good','normal','poor','pending','unmatched']), reason: string(1000), revenueReason: string(1000),
    previousNetQty: number(), recent28NetQty: number(), daily: { '$index': closed({ date: date(),
      netQty: number(), netRevenue: number(), canceledQty: number(true), returnedQty: number(true) }, ['date']) },
  }, ['status','reason']);
  const aggregate = closed({ schemaVersion: enumeration([]), generatedAt: string(40), period,
    comparisonPeriod: period, trendPeriod: period, source: enumeration(['cafe24']), status: enumeration(['ready']),
    items: { '$code': { ...item, '.validate': `$code.matches(${codePattern}) && ${item['.validate']}` } },
    coverage: closed(Object.fromEntries(['orderCount','itemCount','matchedCount','unmatchedCount','productCount',
      'skippedCount','errorCount','cancellationCount','returnCount'].map((key) => [key, number(true)]))),
  });
  aggregate.schemaVersion = { '.validate': 'newData.val() === 1 || newData.val() === 2' };
  aggregate.coverage.complete = { '.validate': 'newData.val() === true' };
  aggregate['.validate'] = "newData.hasChildren(['schemaVersion','generatedAt','period','source','status','coverage']) && newData.child('coverage/complete').val() === true && (newData.child('schemaVersion').val() === 1 || (newData.child('schemaVersion').val() === 2 && newData.hasChildren(['comparisonPeriod','trendPeriod'])))";
  const metadata = closed({ group: enumeration(['new','steady','unclassified']), launchDate: date(true),
    coreSku: { '.validate': 'newData.isBoolean()' }, updatedAt: { '.validate': 'newData.isNumber() && newData.val() > 0 && newData.val() <= now + 60000' },
  }, ['group','launchDate','coreSku','updatedAt']);
  const review = closed({ reviewedAt: { '.validate': 'newData.isNumber() && newData.val() > 0 && newData.val() <= now + 60000' },
    periodStart: date(), periodEnd: date(), asOf: string(40), group: metadata.group, launchDate: date(true),
    coreSku: metadata.coreSku, netQty: number(), previousNetQty: number(), recent28NetQty: number(),
    stockNote: string(1000), conditionsNote: string(1000), judgment: enumeration(['observe','maintain','reorder_review','improve','stop_review']),
    reason: string(2000), nextAction: string(2000), nextReviewDate: date(),
  }, ['reviewedAt','periodStart','periodEnd','asOf','group','launchDate','coreSku','stockNote','conditionsNote','judgment','reason','nextAction','nextReviewDate']);
  const next = structuredClone(existing);
  next.rules.salesPerformance = { ...sales,
    current: { ...aggregate, '.read': read, '.write': `${machine} && newData.exists()` },
    daily: { '.read': owner, '$date': { ...aggregate, '.read': read,
      '.write': `${machine} && newData.exists() && $date.matches(${datePattern})`,
      '.validate': `${aggregate['.validate']} && newData.child('schemaVersion').val() === 2 && newData.child('period/end').val() === $date` } },
    products: { '.read': owner, '$code': { ...metadata,
      '.write': `${owner} && $code.matches(${codePattern}) && newData.exists()` } },
    reviews: { '$code': { '.read': owner, '$review': { ...review,
      '.write': `${owner} && $code.matches(${codePattern}) && $review.matches(/^[A-Za-z0-9_-]{1,120}$/) && !data.exists() && newData.exists()` } } },
  };
  return next;
}
