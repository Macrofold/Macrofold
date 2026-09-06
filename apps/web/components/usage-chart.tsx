'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartColumn, ChevronDown } from 'lucide-react';
import type { Schema } from '../lib/client';
import { money } from '../lib/client';

const measures = [
  { id: 'runs', label: 'Runs', title: 'Agent runs' },
  { id: 'input_tokens', label: 'Input tokens', title: 'Input tokens' },
  { id: 'output_tokens', label: 'Output tokens', title: 'Output tokens' },
  { id: 'cost_micro_usd', label: 'Charges', title: 'Run charges' },
] as const;
const dateLabel = (day: string) =>
  new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function UsageChart({ report }: { report: Schema['Report'] }) {
  const [measure, setMeasure] = useState<(typeof measures)[number]['id']>('runs');
  const [table, setTable] = useState(false);
  const choice = measures.find((item) => item.id === measure)!;
  const format = (value: number) => (measure === 'cost_micro_usd' ? money(value) : value.toLocaleString());
  const grouped = new Map(
    report.metrics
      .filter((metric) => metric.name === measure && metric.dimensions?.day)
      .map((metric) => [metric.dimensions!.day, metric]),
  );
  const rows: { day: string; value: number | null }[] = [];
  for (let time = Date.parse(report.from.slice(0, 10)); time < Date.parse(report.to); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    const metric = grouped.get(day);
    rows.push({
      day,
      value:
        metric?.status === 'missing' ||
        metric?.value === null ||
        report.missing_sources.includes('group_limit')
          ? null
          : Number(metric?.value ?? 0),
    });
  }
  const total = report.metrics.find((metric) => metric.name === measure && !metric.dimensions);
  const empty = rows.every((row) => row.value === 0);
  return (
    <section className="usage-chart-card" aria-label="Daily usage">
      <div className="usage-chart-header">
        <div>
          <span className="usage-chart-eyebrow">
            <ChartColumn size={15} /> ACTIVITY OVER TIME
          </span>
          <h2>{choice.title}</h2>
          <div className="usage-chart-total">
            {total?.value == null || total.status === 'missing' ? 'Incomplete' : format(Number(total.value))}
            <span>in this period</span>
          </div>
        </div>
        <div className="chart-measures" role="group" aria-label="Chart metric">
          {measures.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={measure === item.id}
              onClick={() => setMeasure(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="usage-chart-plot">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            data={rows}
            accessibilityLayer
            aria-label={`Daily ${choice.title.toLowerCase()}`}
            margin={{ top: 12, right: 4, bottom: 4, left: 0 }}
          >
            <CartesianGrid stroke="#e9ecf3" vertical={false} strokeDasharray="3 4" />
            <XAxis
              dataKey="day"
              tickFormatter={dateLabel}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
              tickMargin={12}
              tick={{ fill: '#697180', fontSize: 11 }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={48}
              tick={{ fill: '#697180', fontSize: 11 }}
              tickFormatter={(value: number) =>
                measure === 'cost_micro_usd'
                  ? money(value)
                  : Intl.NumberFormat('en', { notation: 'compact' }).format(value)
              }
            />
            <Tooltip
              cursor={{ fill: '#f2f4fa', radius: 5 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="usage-chart-tooltip">
                    <span>{dateLabel(String(label))} · UTC</span>
                    <strong>{payload[0].value == null ? 'Unknown' : format(Number(payload[0].value))}</strong>
                    <small>{choice.title}</small>
                  </div>
                ) : null
              }
            />
            <Bar
              dataKey="value"
              name={choice.title}
              fill="#5870e8"
              activeBar={{ fill: '#3d53c4' }}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
        {empty && (
          <div className="usage-chart-empty">
            <ChartColumn size={24} />
            <strong>No {choice.label.toLowerCase()} recorded yet</strong>
            <span>Activity will appear here as your agents work.</span>
          </div>
        )}
      </div>
      <div className="usage-chart-footer">
        <span>
          <i /> Daily totals · UTC
          {rows.some((row) => row.value === null) ? ' · Some days have unknown usage' : ''}
        </span>
        <button
          type="button"
          aria-expanded={table}
          aria-controls="usage-daily-values"
          onClick={() => setTable(!table)}
        >
          {table ? 'Hide' : 'View'} daily values <ChevronDown size={13} />
        </button>
      </div>
      {table && (
        <div className="table-wrap usage-daily-table" id="usage-daily-values">
          <table className="data-table">
            <caption className="sr-only">{choice.title} by day, UTC</caption>
            <thead>
              <tr>
                <th scope="col">Date (UTC)</th>
                <th scope="col">{choice.title}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{row.day}</th>
                  <td>{row.value === null ? 'Unknown' : format(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
