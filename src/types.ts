export type ContentType = 'web' | 'images' | 'video' | 'app' | 'standby';

export type RecurrenceMode = 'daily' | 'weekly' | 'dates';

export type OnFinishAction = 'standby' | 'next_schedule' | 'blank_screen' | 'keep_last';

export interface ScheduleRule {
  id: number;
  name: string;
  content_type: ContentType;
  target_ref: string;
  config_json: string;
  start_time: string;
  end_time: string;
  days_of_week: string; // e.g. "1,2,3,4,5"
  start_date: string;
  end_date: string;
  recurrence_mode: RecurrenceMode;
  priority: number;
  enabled: number;
  on_finish_action: OnFinishAction;
  created_at: string;
}

export interface AuthorizedApp {
  id: number;
  name: string;
  binary_path: string;
  args: string;
  display_mode: 'fullscreen' | 'windowed';
  default_duration_min: number;
  on_finish_action: OnFinishAction;
  rpi3b_compatible: number;
  ram_profile: 'low' | 'medium' | 'high';
  enabled: number;
  description: string;
}

export interface StandbyConfig {
  id: number;
  school_name: string;
  subtitle: string;
  messages_json: string;
  logo_path: string;
  photos_folder: string;
  show_clock: number;
  show_date: number;
  theme: 'dark' | 'light';
}

export interface SystemSettings {
  device_name: string;
  hostname: string;
  web_port: string;
  media_root: string;
  samba_enabled: string;
  ssh_enabled: string;
  mdns_enabled: string;
  resolution: string;
  orientation: 'normal' | 'left' | 'right' | 'inverted';
  timezone: string;
  swap_mb: string;
  boot_autostart: string;
  auth_enabled: string;
  app_version: string;
}

export interface MediaAsset {
  name: string;
  relativePath: string;
  category: 'images' | 'videos' | 'web';
  folder: string;
  isDirectory: boolean;
  sizeBytes: number;
  mimeType: string;
  permissions: string;
  modifiedAt: string;
  url: string;
}

export interface ServiceStatus {
  name: string;
  unit: string;
  role: string;
  status: 'active' | 'inactive' | 'degraded';
  pid: number | null;
  memoryMb: number;
  uptimeSec: number;
}

export interface PlayerState {
  status: 'playing' | 'standby' | 'stopped' | 'recovering' | 'error';
  source: 'schedule' | 'manual' | 'standby' | 'none';
  scheduleId: number | null;
  title: string;
  contentType: ContentType;
  targetRef: string;
  activeApp: string;
  commandPreview: string;
  config: Record<string, unknown>;
  startedAt: string;
  manualExpiresAt: string | null;
  exclusiveLockOwner: string;
  lastError: string | null;
}

export interface HostTelemetry {
  deviceName: string;
  hostname: string;
  mdnsAddress: string;
  localIp: string;
  osVersion: string;
  architecture: string;
  hardwareProfile: string;
  isRaspberryPi: boolean;
  uptimeSec: number;
  cpuPercent: number;
  cpuTempC: number | null;
  ramUsedMb: number;
  ramTotalMb: number;
  ramAvailableMb: number;
  swapUsedMb: number;
  swapTotalMb: number;
  diskFreeGb: number;
  diskTotalGb: number;
  diskUsedPercent: number;
  networkState: 'online' | 'degraded';
  networkInterfaces: Array<{ name: string; ip: string; mac: string; family: string }>;
  resolution: string;
  orientation: string;
  sshActive: boolean;
  sambaActive: boolean;
  mdnsActive: boolean;
  binaries: Record<string, { installed: boolean; path: string | null; rpi3bNote: string }>;
  services: ServiceStatus[];
  processes: Array<{ pid: number; command: string; cpu: number; mem: number; rssMb: number }>;
  timestamp: string;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  actor: string;
  category: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface AuthStatus {
  authEnabled: boolean;
  hasAdminUser: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface PackageFileEntry {
  path: string;
  sizeBytes: number;
  content: string;
}

export interface HealthCheckReport {
  overall: 'ok' | 'warning' | 'error';
  checkedAt: string;
  checks: Array<{
    id: string;
    component: string;
    status: 'ok' | 'warning' | 'error';
    detail: string;
  }>;
}
