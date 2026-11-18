import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import type { HostTelemetry, ServiceStatus } from '../src/types.ts';
import { getSettingsMap } from './db.ts';

const execFileAsync = promisify(execFile);

let prevCpuStats: { idle: number; total: number } | null = null;

function readCpuUsagePercent(): number {
  try {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const t = cpu.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    if (!prevCpuStats) {
      prevCpuStats = { idle, total };
      const load = os.loadavg()[0] || 0;
      return Math.min(100, Math.round((load / Math.max(1, cpus.length)) * 1000) / 10);
    }
    const idleDiff = idle - prevCpuStats.idle;
    const totalDiff = total - prevCpuStats.total;
    prevCpuStats = { idle, total };
    if (totalDiff <= 0) return 0;
    return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
  } catch {
    return 0;
  }
}

function readCpuTempC(): number | null {
  const candidates = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/class/hwmon/hwmon0/temp1_input',
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = Number(fs.readFileSync(file, 'utf-8').trim());
        if (!Number.isNaN(raw) && raw > 0) {
          return Math.round((raw > 1000 ? raw / 1000 : raw) * 10) / 10;
        }
      }
    } catch {
      // ignore unreadable sensor
    }
  }
  return null;
}

function readMemInfo(): {
  ramTotalMb: number;
  ramUsedMb: number;
  ramAvailableMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
} {
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const raw = fs.readFileSync('/proc/meminfo', 'utf-8');
      const map: Record<string, number> = {};
      for (const line of raw.split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
        if (match) {
          map[match[1]] = Number(match[2]);
        }
      }
      const totalKb = map.MemTotal || Math.round(os.totalmem() / 1024);
      const availKb = map.MemAvailable ?? map.MemFree ?? Math.round(os.freemem() / 1024);
      const swapTotalKb = map.SwapTotal || 0;
      const swapFreeKb = map.SwapFree || 0;
      return {
        ramTotalMb: Math.round(totalKb / 1024),
        ramUsedMb: Math.round((totalKb - availKb) / 1024),
        ramAvailableMb: Math.round(availKb / 1024),
        swapTotalMb: Math.round(swapTotalKb / 1024),
        swapUsedMb: Math.round((swapTotalKb - swapFreeKb) / 1024),
      };
    }
  } catch {
    // fallback to os
  }
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));
  return {
    ramTotalMb: totalMb,
    ramUsedMb: totalMb - freeMb,
    ramAvailableMb: freeMb,
    swapTotalMb: 0,
    swapUsedMb: 0,
  };
}

function readOsPrettyName(): string {
  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const match = content.match(/^PRETTY_NAME="([^"]+)"/m);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }
  return `${os.type()} ${os.release()}`;
}

async function readDiskUsage(): Promise<{ freeGb: number; totalGb: number; usedPercent: number }> {
  try {
    const { stdout } = await execFileAsync('df', ['-k', '/'], { timeout: 2000 });
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const cols = lines[1].trim().split(/\s+/);
      const totalKb = Number(cols[1]) || 0;
      const usedKb = Number(cols[2]) || 0;
      const availKb = Number(cols[3]) || 0;
      return {
        totalGb: Math.round((totalKb / (1024 * 1024)) * 10) / 10,
        freeGb: Math.round((availKb / (1024 * 1024)) * 10) / 10,
        usedPercent: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
      };
    }
  } catch {
    // fallback
  }
  return { freeGb: 0, totalGb: 0, usedPercent: 0 };
}

async function readProcesses(): Promise<Array<{ pid: number; command: string; cpu: number; mem: number; rssMb: number }>> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-eo', 'pid,comm,%cpu,%mem,rss', '--sort=-rss'],
      { timeout: 2000 }
    );
    const rows = stdout.trim().split('\n').slice(1, 16);
    return rows
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) return null;
        return {
          pid: Number(parts[0]),
          command: parts[1],
          cpu: Number(parts[2]),
          mem: Number(parts[3]),
          rssMb: Math.round((Number(parts[4]) / 1024) * 10) / 10,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  } catch {
    return [];
  }
}

async function checkBinary(names: string[], rpi3bNote: string): Promise<{ installed: boolean; path: string | null; rpi3bNote: string }> {
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync('which', [name], { timeout: 1000 });
      const binPath = stdout.trim();
      if (binPath) {
        return { installed: true, path: binPath, rpi3bNote };
      }
    } catch {
      // not found
    }
  }
  return { installed: false, path: null, rpi3bNote };
}

let cachedBinaries: HostTelemetry['binaries'] | null = null;
let lastBinCheck = 0;

async function detectBinaries(): Promise<HostTelemetry['binaries']> {
  const now = Date.now();
  if (cachedBinaries && now - lastBinCheck < 30000) {
    return cachedBinaries;
  }
  const [chromium, firefox, feh, mpv, retroarch, smbd, avahi, xrandr] = await Promise.all([
    checkBinary(['chromium-browser', 'chromium'], 'Usar solo bajo demanda; cerrar al cambiar contenido para liberar ~420 MB RAM'),
    checkBinary(['firefox-esr', 'firefox'], 'Opcional; requiere swap >= 1024 MB en RPi 3B de 1 GB RAM'),
    checkBinary(['feh'], 'Recomendado en RPi 3B para presentaciones (< 35 MB RAM)'),
    checkBinary(['mpv'], 'Eficiente para vídeo local H.264 MP4/MKV en VideoCore IV'),
    checkBinary(['retroarch'], 'Compatible en modo exclusivo tras cerrar el navegador'),
    checkBinary(['smbd'], 'Comparte /opt/edusignage/media en red local Windows/macOS'),
    checkBinary(['avahi-daemon'], 'Publica edusignage.local mediante mDNS sin DNS externo'),
    checkBinary(['xrandr'], 'Gestiona resolución y rotación sobre servidor X11/:0'),
  ]);
  cachedBinaries = {
    chromium,
    firefox,
    feh,
    mpv,
    retroarch,
    smbd,
    avahi,
    xrandr,
  };
  lastBinCheck = now;
  return cachedBinaries;
}

export async function collectHostTelemetry(serviceStates: ServiceStatus[]): Promise<HostTelemetry> {
  const settings = getSettingsMap();
  const [disk, processes, binaries] = await Promise.all([
    readDiskUsage(),
    readProcesses(),
    detectBinaries(),
  ]);

  const mem = readMemInfo();
  const ifacesRaw = os.networkInterfaces();
  const networkInterfaces: HostTelemetry['networkInterfaces'] = [];
  for (const [name, list] of Object.entries(ifacesRaw)) {
    if (!list) continue;
    for (const iface of list) {
      if (!iface.internal && iface.family === 'IPv4') {
        networkInterfaces.push({
          name,
          ip: iface.address,
          mac: iface.mac,
          family: iface.family,
        });
      }
    }
  }

  const arch = os.arch();
  const isRaspberryPi =
    arch === 'arm' ||
    arch === 'arm64' ||
    (fs.existsSync('/proc/device-tree/model') &&
      fs.readFileSync('/proc/device-tree/model', 'utf-8').toLowerCase().includes('raspberry'));

  let hardwareProfile = `Host Linux (${arch}) · Perfil de despliegue: Raspberry Pi 3 Model B (1 GB RAM / ARMv7l)`;
  if (isRaspberryPi && fs.existsSync('/proc/device-tree/model')) {
    hardwareProfile = fs.readFileSync('/proc/device-tree/model', 'utf-8').replace(/\0/g, '').trim();
  }

  const configuredHostname = settings.hostname || os.hostname();
  const localIp = networkInterfaces[0]?.ip || '127.0.0.1';

  return {
    deviceName: settings.device_name || 'EduSignage Hall Principal',
    hostname: configuredHostname,
    mdnsAddress: `${configuredHostname}.local`,
    localIp,
    osVersion: readOsPrettyName(),
    architecture: `${os.platform()} / ${arch}`,
    hardwareProfile,
    isRaspberryPi,
    uptimeSec: Math.round(os.uptime()),
    cpuPercent: readCpuUsagePercent(),
    cpuTempC: readCpuTempC(),
    ramUsedMb: mem.ramUsedMb,
    ramTotalMb: mem.ramTotalMb,
    ramAvailableMb: mem.ramAvailableMb,
    swapUsedMb: mem.swapUsedMb,
    swapTotalMb: mem.swapTotalMb,
    diskFreeGb: disk.freeGb,
    diskTotalGb: disk.totalGb,
    diskUsedPercent: disk.usedPercent,
    networkState: networkInterfaces.length > 0 ? 'online' : 'degraded',
    networkInterfaces,
    resolution: settings.resolution || '1920x1080',
    orientation: settings.orientation || 'normal',
    sshActive: settings.ssh_enabled === 'true',
    sambaActive: settings.samba_enabled === 'true',
    mdnsActive: settings.mdns_enabled === 'true',
    binaries,
    services: serviceStates,
    processes,
    timestamp: new Date().toISOString(),
  };
}
