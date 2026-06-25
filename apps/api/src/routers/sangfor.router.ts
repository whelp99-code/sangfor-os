import { z } from 'zod';
import { router, protectedProcedure, requireRole } from './trpc';

const adminProcedure = protectedProcedure.use(requireRole('admin'));

export interface Policy {
  id: string;
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
}

export interface SangforDevice {
  id: string;
  name: string;
  type: string;
  ip: string;
  status: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  severity: string;
  message: string;
  resolved: boolean;
  createdAt: string;
}

const policiesStore: Policy[] = [];
const devicesStore: SangforDevice[] = [];
const alertsStore: Alert[] = [];

export const sangforRouter = router({
  createPolicy: adminProcedure
    .input(z.object({ type: z.string(), name: z.string(), description: z.string().optional(), enabled: z.boolean().optional().default(true) }))
    .mutation(async ({ input }) => {
      const policy: Policy = {
        id: `pol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: input.type,
        name: input.name,
        description: input.description ?? '',
        enabled: input.enabled,
        createdAt: new Date().toISOString(),
      };
      policiesStore.push(policy);
      return policy;
    }),

  policies: protectedProcedure
    .input(z.object({ type: z.string().optional(), enabled: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      let result = [...policiesStore];
      if (input?.type) result = result.filter(p => p.type === input.type);
      if (input?.enabled !== undefined) result = result.filter(p => p.enabled === input.enabled);
      return { policies: result };
    }),

  createDevice: adminProcedure
    .input(z.object({ name: z.string(), type: z.string(), ip: z.string() }))
    .mutation(async ({ input }) => {
      const device: SangforDevice = {
        id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        type: input.type,
        ip: input.ip,
        status: 'online',
        createdAt: new Date().toISOString(),
      };
      devicesStore.push(device);
      return device;
    }),

  devices: protectedProcedure
    .input(z.object({ type: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let result = [...devicesStore];
      if (input?.type) result = result.filter(d => d.type === input.type);
      if (input?.status) result = result.filter(d => d.status === input.status);
      return { devices: result };
    }),

  createAlert: adminProcedure
    .input(z.object({ severity: z.string(), message: z.string() }))
    .mutation(async ({ input }) => {
      const alert: Alert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        severity: input.severity,
        message: input.message,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      alertsStore.push(alert);
      return alert;
    }),

  alerts: protectedProcedure
    .input(z.object({ severity: z.string().optional(), resolved: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      let result = [...alertsStore];
      if (input?.severity) result = result.filter(a => a.severity === input.severity);
      if (input?.resolved !== undefined) result = result.filter(a => a.resolved === input.resolved);
      return { alerts: result };
    }),

  resolveAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      const alert = alertsStore.find(a => a.id === input.alertId);
      if (alert) alert.resolved = true;
      return { success: true, alertId: input.alertId };
    }),

  stats: protectedProcedure.query(async () => {
    const totalAlerts = alertsStore.length;
    const unresolvedAlerts = alertsStore.filter(a => !a.resolved).length;
    const criticalAlerts = alertsStore.filter(a => a.severity === 'critical').length;
    const totalDevices = devicesStore.length;
    const onlineDevices = devicesStore.filter(d => d.status === 'online').length;
    return { totalAlerts, unresolvedAlerts, criticalAlerts, totalDevices, onlineDevices };
  }),
});
