interface DashboardMissionBase {
  id: string;
  name: string;
  isCompleted: boolean;
  reward: string;
  expiresAt: string | null;
}

export interface VisitsDashboardMission extends DashboardMissionBase {
  goalType: 'VISITS';
  targetValue: number;
  currentValue: number;
  remainingValue: number;
}

export interface AmountDashboardMission extends DashboardMissionBase {
  goalType: 'AMOUNT';
  targetValue: string;
  currentValue: string;
  remainingValue: string;
}

export type DashboardMission = VisitsDashboardMission | AmountDashboardMission;

export interface B2cDashboardResponse {
  customer: { id: string; tenantId: string; name: string; phone: string };
  pointsBalance: number;
  missions: DashboardMission[];
}
