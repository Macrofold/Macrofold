'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Activity, ChartNoAxesCombined, CreditCard, Terminal } from 'lucide-react';
import { api, usePages, money, type Schema } from '../lib/client';
import { ErrorState, Loading, More, PageHeading, SectionHeading, Select } from './ui';
import { Stat } from './dashboard-shared';
import { RequestsTable } from './requests-table';
import './usage.css';

const UsageChart = dynamic(() => import('./usage-chart').then((module) => module.UsageChart), {
  loading: () => (
    <div className="usage-chart-loading">
      <Loading />
    </div>
  ),
});

export function UsageView() {
  const [days, setDays] = useState('30');
  const today = new Date().toISOString().slice(0, 10);
  // Include today once: "7 days" is today and the six preceding UTC dates.
  const from = new Date(Date.parse(today) - (Number(days) - 1) * 86400000).toISOString();
  const reportPath = `/v1/usage?from=${from}&group_by=day`;
  const report = useQuery({
    queryKey: [reportPath],
    queryFn: () => api<Schema['Report']>(reportPath),
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
    retry: 1,
  });
  const requests = usePages<Schema['RequestRecord']>(`/v1/requests?from=${from}&limit=25`, 10000);
  const metric = (name: string) =>
    report.data?.metrics.find((item) => item.name === name && !item.dimensions);
  const value = (name: string, currency = false) => {
    const item = metric(name);
    if (!item) return '—';
    if (item.value === null || item.status === 'missing') return 'Incomplete';
    return currency ? money(String(item.value)) : Number(item.value).toLocaleString();
  };
  return (
    <div className="page usage-page">
      <PageHeading
        eyebrow="WORKLOAD & SPENDING"
        title="Usage"
        description="Understand your agents’ activity, from the first request to the last token."
        action={
          <Select
            aria-label="Reporting period"
            value={days}
            onValueChange={setDays}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
        }
      />
      {report.error && <ErrorState error={report.error} retry={() => void report.refetch()} />}
      <div className="stats-grid" aria-busy={report.isPlaceholderData}>
        <Stat
          label="Agent runs"
          value={value('runs')}
          detail="Admitted during this period"
          icon={<Activity />}
        />
        <Stat
          label="Input tokens"
          value={value('input_tokens')}
          detail="Provider reported usage"
          icon={<ChartNoAxesCombined />}
        />
        <Stat
          label="Output tokens"
          value={value('output_tokens')}
          detail="Provider reported usage"
          icon={<Terminal />}
        />
        <Stat
          label="Run charges"
          value={value('cost_micro_usd', true)}
          detail="Authoritative ledger charges"
          icon={<CreditCard />}
        />
      </div>
      {report.isPending ? (
        <div className="usage-chart-loading">
          <Loading />
        </div>
      ) : (
        report.data && <UsageChart report={report.data} />
      )}
      {!!report.data?.missing_sources.length && (
        <div className="info-note" role="status">
          Some usage is incomplete. Unreported values appear as unknown; they are never counted as zero.
        </div>
      )}
      <section className="usage-requests">
        <SectionHeading
          title="Request activity"
          description="Every API and dashboard request, with prompts and secrets kept out of the audit trail."
        />
        {requests.isPending ? (
          <Loading />
        ) : requests.error ? (
          <ErrorState error={requests.error} retry={() => void requests.refetch()} />
        ) : (
          <>
            <RequestsTable records={requests.data?.data || []} />
            <More query={requests} label="Older requests" />
          </>
        )}
      </section>
    </div>
  );
}
