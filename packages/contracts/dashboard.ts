/** Private dashboard freshness protocol. These are invalidations, never run events. */
export const dashboardCategories = ['runs', 'workspace', 'git'] as const;
export type DashboardCategory = (typeof dashboardCategories)[number];
export type DashboardSignal = { category: DashboardCategory; organization_id: string };
