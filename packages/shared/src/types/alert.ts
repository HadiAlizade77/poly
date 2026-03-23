export type AlertType = 'trade' | 'risk' | 'system' | 'ai' | 'performance' | 'opportunity';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: Date;
  read_at: Date | null;
}
