import { useEffect, useRef, useState } from 'react';
import type { AuthorizedApp, HostTelemetry, PlayerState, ScheduleRule, ServiceStatus, StandbyConfig } from '../types';

interface WsHandlers {
  onTelemetry: (t: HostTelemetry) => void;
  onPlayer: (p: PlayerState) => void;
  onServices: (s: ServiceStatus[]) => void;
  onSchedules: (rows: ScheduleRule[]) => void;
  onApps: (rows: AuthorizedApp[]) => void;
  onStandby: (cfg: StandbyConfig) => void;
}

export function useWebSocketState(enabled: boolean, handlers: WsHandlers): 'connected' | 'connecting' | 'disconnected' {
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => {
        if (!stopped) setStatus('connected');
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'state:init') {
            if (msg.data.telemetry) handlersRef.current.onTelemetry(msg.data.telemetry);
            if (msg.data.player) handlersRef.current.onPlayer(msg.data.player);
            if (msg.data.services) handlersRef.current.onServices(msg.data.services);
          } else if (msg.type === 'telemetry:tick') {
            handlersRef.current.onTelemetry(msg.data);
          } else if (msg.type === 'player:changed') {
            handlersRef.current.onPlayer(msg.data);
          } else if (msg.type === 'services:updated') {
            handlersRef.current.onServices(msg.data);
          } else if (msg.type === 'schedules:updated') {
            handlersRef.current.onSchedules(msg.data);
          } else if (msg.type === 'apps:updated') {
            handlersRef.current.onApps(msg.data);
          } else if (msg.type === 'standby:updated') {
            handlersRef.current.onStandby(msg.data);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setStatus('disconnected');
        reconnectTimer = window.setTimeout(connect, 2500);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]);

  return status;
}
