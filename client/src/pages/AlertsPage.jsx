import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import AlertsSummary from '../components/alerts/AlertsSummary';
import AlertsList from '../components/alerts/AlertsList';
import AlertHistory from '../components/alerts/AlertHistory';
import EditAlertModal from '../components/alerts/EditAlertModal';
import { apiJSON } from '../config/api';
import { useToast } from '../context/ToastContext';

export default function AlertsPage() {
  const toast = useToast();
  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [removedAlertIds, setRemovedAlertIds] = useState(new Set());

  const visibleAlerts = useMemo(
    () => alerts.filter((item) => !removedAlertIds.has(item.alert_id)),
    [alerts, removedAlertIds]
  );

  const alertsById = useMemo(
    () => new Map(visibleAlerts?.map((item) => [item.alert_id, item])),
    [visibleAlerts]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [alertsResult, historyResult] = await Promise.all([
        apiJSON('/api/alerts'),
        apiJSON('/api/alerts/history'),
      ]);
      setAlerts(Array.isArray(alertsResult) ? alertsResult : []);
      setHistory(Array.isArray(historyResult) ? historyResult : []);
    } catch (error) {
      toast.error(`Failed to load alerts: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function disableAlert(alert) {
    await apiJSON('/api/alerts/disable', {
      method: 'POST',
      body: JSON.stringify({ alert_id: alert.alert_id }),
    });
    setAlerts((current) => current?.map((item) => (
      item.alert_id === alert.alert_id ? { ...item, enabled: false } : item
    )));
  }

  async function recreateEnabledAlert(alert, overrides = {}) {
    const payload = {
      alert_name: overrides.alert_name ?? alert.alert_name,
      query_tree: alert.query_tree,
      message_template: overrides.message_template ?? alert.message_template,
      frequency: overrides.frequency ?? alert.frequency,
      enabled: overrides.enabled ?? true,
      enable_alert: true,
    };

    const response = await apiJSON('/api/alerts/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const replacement = response?.alert;
    if (!replacement) throw new Error('Alert create response missing alert payload');

    setAlerts((current) => [replacement, ...current.filter((item) => item.alert_id !== alert.alert_id)]);
    setRemovedAlertIds((current) => {
      const next = new Set(current);
      next.delete(replacement.alert_id);
      next.delete(alert.alert_id);
      return next;
    });
    return replacement;
  }

  async function handleToggleEnabled(alert) {
    try {
      if (alert.enabled) {
        await disableAlert(alert);
        toast.info('Alert disabled');
      } else {
        await recreateEnabledAlert(alert, { enabled: true });
        toast.success('Alert enabled');
      }
    } catch (error) {
      toast.error(`Toggle failed: ${error.message}`);
    }
  }

  async function handleDisable(alert) {
    try {
      await disableAlert(alert);
      toast.info('Alert disabled');
    } catch (error) {
      toast.error(`Disable failed: ${error.message}`);
    }
  }

  async function handleDelete(alert) {
    try {
      if (alert.enabled) {
        await disableAlert(alert);
      }
      setRemovedAlertIds((current) => new Set(current).add(alert.alert_id));
      toast.warn('Delete endpoint is unavailable; alert disabled and hidden.');
    } catch (error) {
      toast.error(`Delete failed: ${error.message}`);
    }
  }

  async function handleTest(alert) {
    try {
      await apiJSON('/api/alerts/test', {
        method: 'POST',
        body: JSON.stringify({ alert_id: alert.alert_id }),
      });
      toast.success(`Test alert sent for ${alert.alert_name}`);
    } catch (error) {
      toast.warn(`Test endpoint unavailable (${error.message}). Showing simulated alert.`);
      toast.info(`Simulated: ${alert.alert_name} triggered for TEST at ${new Date().toLocaleTimeString()}`);
      return;
    }
    toast.info(`Simulated: ${alert.alert_name} triggered for TEST at ${new Date().toLocaleTimeString()}`);
  }

  async function handleSaveEdit(changes) {
    if (!editingAlert) return;

    setSavingEdit(true);
    try {
      if (editingAlert.enabled) {
        await disableAlert(editingAlert);
      }

      await recreateEnabledAlert(editingAlert, {
        alert_name: changes.alert_name,
        frequency: changes.frequency,
        enabled: changes.enabled,
        message_template: changes.message_template,
      });

      setEditingAlert(null);
      toast.success('Alert updated');
    } catch (error) {
      toast.error(`Update failed: ${error.message}`);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <PageContainer className="space-y-3">
      <PageHeader
        title="Alerts Command Center"
        subtitle="Manage active alert rules, toggles, and trigger history from one dashboard."
        actions={(
          <button type="button" className="btn-secondary h-10 rounded-lg px-3 text-sm" onClick={loadData}>
            <RefreshCw size={15} className="mr-1 inline" />
            Refresh
          </button>
        )}
      />

      <AlertsSummary alerts={visibleAlerts} history={history} loading={loading} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="rounded-2xl p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Bell size={16} />
            Active Alerts
          </div>
          <AlertsList
            alerts={visibleAlerts}
            loading={loading}
            onToggleEnabled={handleToggleEnabled}
            onEdit={setEditingAlert}
            onDisable={handleDisable}
            onDelete={handleDelete}
            onTest={handleTest}
          />
        </Card>

        <Card className="rounded-2xl p-3">
          <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Triggered Alerts History</div>
          <AlertHistory history={history} alertsById={alertsById} loading={loading} />
        </Card>
      </div>

      <EditAlertModal
        alert={editingAlert}
        onClose={() => setEditingAlert(null)}
        onSave={handleSaveEdit}
        saving={savingEdit}
      />
    </PageContainer>
  );
}
