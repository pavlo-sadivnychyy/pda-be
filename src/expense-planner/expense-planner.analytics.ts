type DecimalLike = string | number | null | undefined;

export type MonthAnalyticsInput = {
  monthKey: string;
  incomePlanned?: DecimalLike;
  incomeActual?: DecimalLike;
  items: Array<{
    id: string;
    title: string;
    type: 'PLANNED' | 'ACTUAL';
    amountPlanned?: DecimalLike;
    amountActual?: DecimalLike;
    expenseDate: Date;
    category?: {
      id: string;
      name: string;
      color?: string | null;
      icon?: string | null;
    } | null;
  }>;
};

export type MonthHistoryAnalyticsInput = Array<{
  monthKey: string;
  incomePlanned?: DecimalLike;
  incomeActual?: DecimalLike;
  items: Array<{
    type: 'PLANNED' | 'ACTUAL';
    amountPlanned?: DecimalLike;
    amountActual?: DecimalLike;
  }>;
}>;

function toNumber(v: DecimalLike): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function getDaysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function buildMonthAnalytics(input: MonthAnalyticsInput) {
  const totalPlanned = round2(
    input.items
      .filter((x) => x.type === 'PLANNED')
      .reduce((sum, x) => sum + toNumber(x.amountPlanned), 0),
  );

  const totalActual = round2(
    input.items
      .filter((x) => x.type === 'ACTUAL')
      .reduce((sum, x) => sum + toNumber(x.amountActual), 0),
  );

  const incomePlanned = round2(toNumber(input.incomePlanned));
  const incomeActual = round2(toNumber(input.incomeActual));

  const balancePlanned = round2(incomePlanned - totalPlanned);
  const balanceActual = round2(incomeActual - totalActual);

  const budgetUsagePercent =
    totalPlanned > 0 ? round2((totalActual / totalPlanned) * 100) : 0;

  const categoryMap = new Map<
    string,
    {
      categoryId: string;
      name: string;
      color?: string | null;
      icon?: string | null;
      planned: number;
      actual: number;
    }
  >();

  for (const item of input.items) {
    const id = item.category?.id ?? 'uncategorized';
    const name = item.category?.name ?? 'Інше';

    if (!categoryMap.has(id)) {
      categoryMap.set(id, {
        categoryId: id,
        name,
        color: item.category?.color ?? null,
        icon: item.category?.icon ?? null,
        planned: 0,
        actual: 0,
      });
    }

    const row = categoryMap.get(id)!;

    if (item.type === 'PLANNED') {
      row.planned += toNumber(item.amountPlanned);
    } else {
      row.actual += toNumber(item.amountActual);
    }
  }

  const byCategory = [...categoryMap.values()]
    .map((x) => ({
      ...x,
      planned: round2(x.planned),
      actual: round2(x.actual),
      delta: round2(x.actual - x.planned),
      usagePercent: x.planned > 0 ? round2((x.actual / x.planned) * 100) : 0,
    }))
    .sort((a, b) => b.actual - a.actual || b.planned - a.planned);

  const donut = byCategory
    .filter((x) => x.actual > 0)
    .map((x) => ({
      id: x.categoryId,
      label: x.name,
      value: x.actual,
      color: x.color ?? undefined,
      icon: x.icon ?? undefined,
    }));

  const days = getDaysInMonth(input.monthKey);
  const dailyMap = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    planned: 0,
    actual: 0,
    cumulativePlanned: 0,
    cumulativeActual: 0,
  }));

  for (const item of input.items) {
    const day = new Date(item.expenseDate).getDate();
    if (!dailyMap[day - 1]) continue;

    if (item.type === 'PLANNED') {
      dailyMap[day - 1].planned += toNumber(item.amountPlanned);
    } else {
      dailyMap[day - 1].actual += toNumber(item.amountActual);
    }
  }

  let cumulativePlanned = 0;
  let cumulativeActual = 0;

  const cumulativeByDay = dailyMap.map((row) => {
    cumulativePlanned += row.planned;
    cumulativeActual += row.actual;

    return {
      day: row.day,
      planned: round2(row.planned),
      actual: round2(row.actual),
      cumulativePlanned: round2(cumulativePlanned),
      cumulativeActual: round2(cumulativeActual),
    };
  });

  const topLeaks = byCategory
    .filter((x) => x.delta > 0)
    .slice(0, 5)
    .map((x) => ({
      categoryId: x.categoryId,
      name: x.name,
      overspend: x.delta,
    }));

  const daysLeft = Math.max(days - new Date().getDate(), 0);
  const recommendedDailyLimit =
    daysLeft > 0 ? round2(Math.max(balanceActual, 0) / daysLeft) : 0;

  return {
    summary: {
      incomePlanned,
      incomeActual,
      totalPlanned,
      totalActual,
      balancePlanned,
      balanceActual,
      budgetUsagePercent,
      recommendedDailyLimit,
    },
    byCategory,
    donut,
    cumulativeByDay,
    topLeaks,
  };
}

export function buildHistoryAnalytics(input: MonthHistoryAnalyticsInput) {
  const trend = input
    .map((month) => {
      const totalPlanned = month.items
        .filter((x) => x.type === 'PLANNED')
        .reduce((sum, x) => sum + toNumber(x.amountPlanned), 0);

      const totalActual = month.items
        .filter((x) => x.type === 'ACTUAL')
        .reduce((sum, x) => sum + toNumber(x.amountActual), 0);

      return {
        monthKey: month.monthKey,
        incomePlanned: round2(toNumber(month.incomePlanned)),
        incomeActual: round2(toNumber(month.incomeActual)),
        totalPlanned: round2(totalPlanned),
        totalActual: round2(totalActual),
        delta: round2(totalActual - totalPlanned),
      };
    })
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];

  return {
    trend,
    comparison:
      last && prev
        ? {
            currentMonth: last.monthKey,
            prevMonth: prev.monthKey,
            actualDiff: round2(last.totalActual - prev.totalActual),
            actualDiffPercent:
              prev.totalActual > 0
                ? round2(
                    ((last.totalActual - prev.totalActual) / prev.totalActual) *
                      100,
                  )
                : 0,
          }
        : null,
  };
}
