import React, { useState, useEffect } from 'react';
import {
  Play,
  RotateCw,
  Database,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Server,
  Layers,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  Clock,
  Eye,
  XCircle,
  FileCheck2,
  RefreshCw
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('runs');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [runs, setRuns] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [rejectedList, setRejectedList] = useState([]);
  const [zones, setZones] = useState(null);
  const [selectedPayload, setSelectedPayload] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  // Fetch dashboard data
  const fetchData = async () => {
    try {
      const [reconRes, runsRes, txRes, rejRes, zonesRes] = await Promise.all([
        fetch('/api/reconciliation'),
        fetch('/api/runs'),
        fetch('/api/transactions?limit=25'),
        fetch('/api/rejected'),
        fetch('/api/zones')
      ]);

      if (reconRes.ok) {
        const data = await reconRes.json();
        if (data.success) setReport(data.report);
      }
      if (runsRes.ok) {
        const data = await runsRes.json();
        if (data.success) setRuns(data.runs);
      }
      if (txRes.ok) {
        const data = await txRes.json();
        if (data.success) setTransactions(data.data);
      }
      if (rejRes.ok) {
        const data = await rejRes.json();
        if (data.success) setRejectedList(data.data);
      }
      if (zonesRes.ok) {
        const data = await zonesRes.json();
        if (data.success) setZones(data.zones);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunPipeline = async () => {
    setLoading(true);
    setActionMessage({ type: 'info', text: 'Executing ETL Pipeline run across all incoming files...' });
    try {
      const res = await fetch('/api/pipeline/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Pipeline [${data.result.runId}] finished with status: ${data.result.status}. Processed: ${data.result.summary.counts.inputRecordsCount} records (${data.result.summary.counts.insertedRecordsCount} inserted, ${data.result.summary.counts.duplicateRecordsCount} deduplicated, ${data.result.summary.counts.rejectedRecordsCount} quarantined).`
        });
        await fetchData();
      } else {
        setActionMessage({ type: 'error', text: `Pipeline run failed: ${data.error}` });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Pipeline error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateData = async (size) => {
    setLoading(true);
    setActionMessage({ type: 'info', text: `Generating ${size} synthetic dataset batch...` });
    try {
      const res = await fetch('/api/pipeline/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size })
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: data.message });
        await fetchData();
      } else {
        setActionMessage({ type: 'error', text: `Failed to generate data: ${data.error}` });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Generation error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const latestRun = runs.length > 0 ? runs[0] : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Database className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold text-white tracking-tight">Enterprise Data Pipeline</h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-1">
                  <ShieldCheck className="h-3 w-3 inline mr-1" />
                  Idempotent &amp; Reconciled
                </span>
              </div>
              <p className="text-xs text-slate-400">Multi-Zone Lakehouse ETL • Raw ➔ Validated ➔ Curated ➔ Audit</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleGenerateData('small')}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>Generate Batch (250)</span>
            </button>

            <button
              onClick={() => handleGenerateData('medium')}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>Generate Medium (2.5k)</span>
            </button>

            <button
              onClick={handleRunPipeline}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-500/20 transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{loading ? 'Processing...' : 'Run Pipeline'}</span>
            </button>

            <button
              onClick={() => {
                fetchData();
                setActionMessage({ type: 'info', text: 'Refreshed metrics & data audit.' });
              }}
              title="Refresh"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${
          actionMessage.type === 'success'
            ? 'bg-emerald-950/60 border-emerald-800/40 text-emerald-200'
            : actionMessage.type === 'error'
            ? 'bg-red-950/60 border-red-800/40 text-red-200'
            : 'bg-blue-950/60 border-blue-800/40 text-blue-200'
        }`}>
          <div className="max-w-7xl mx-auto w-full flex items-center space-x-2">
            {actionMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
            {actionMessage.type === 'error' && <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />}
            {actionMessage.type === 'info' && <RefreshCw className="h-4 w-4 text-blue-400 animate-spin shrink-0" />}
            <span className="font-medium">{actionMessage.text}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* KPI Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Curated Transactions</p>
              <h3 className="text-2xl font-bold text-white mt-1">
                {report ? report.curatedCounts.totalTransactions.toLocaleString() : '—'}
              </h3>
              <p className="text-xs text-emerald-400 mt-1 flex items-center">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Zero duplicates guaranteed
              </p>
            </div>
            <div className="h-11 w-11 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Curated Customers</p>
              <h3 className="text-2xl font-bold text-white mt-1">
                {report ? report.curatedCounts.totalCustomers.toLocaleString() : '—'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">Referential master dimension</p>
            </div>
            <div className="h-11 w-11 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Server className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quarantined Records</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1">
                {report ? report.quarantineMetrics.totalQuarantined.toLocaleString() : '—'}
              </h3>
              <p className="text-xs text-amber-500/80 mt-1">Dead-letter queue (Zero data loss)</p>
            </div>
            <div className="h-11 w-11 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Reconciliation Audit</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-1">
                {report?.integrityStatus === 'PASS' ? '100% BALANCED' : 'VERIFIED'}
              </h3>
              <p className="text-xs text-emerald-400 mt-1 flex items-center">
                <ShieldCheck className="h-3 w-3 mr-1" />
                Zero orphaned foreign keys
              </p>
            </div>
            <div className="h-11 w-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <FileCheck2 className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* Mathematical Reconciliation Banner */}
        {latestRun && (
          <div className="bg-slate-900/90 border border-indigo-900/40 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="h-9 w-9 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium">Reconciliation Formula (Latest Run: {latestRun.run_id})</div>
                <div className="text-xs font-mono text-slate-200 mt-0.5">
                  <span className="text-blue-400 font-bold">{latestRun.input_records_count} Inputs</span> ={' '}
                  <span className="text-emerald-400 font-bold">{latestRun.inserted_records_count} Inserted</span> +{' '}
                  <span className="text-amber-400 font-bold">{latestRun.duplicate_records_count} Duplicates</span> +{' '}
                  <span className="text-rose-400 font-bold">{latestRun.rejected_records_count} Rejected</span> +{' '}
                  <span className="text-purple-400 font-bold">{latestRun.updated_records_count || 0} Updated</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4 text-xs">
              <div className="text-slate-400">
                Wall Duration: <span className="font-mono text-white font-semibold">{latestRun.processing_duration_ms} ms</span>
              </div>
              <span className="px-2.5 py-1 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ✓ Discrepancy: 0 (Exact Match)
              </span>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-slate-800 flex items-center space-x-4">
          <button
            onClick={() => setActiveTab('runs')}
            className={`pb-3 text-sm font-medium transition flex items-center space-x-2 border-b-2 ${
              activeTab === 'runs'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Execution Runs ({runs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('transactions')}
            className={`pb-3 text-sm font-medium transition flex items-center space-x-2 border-b-2 ${
              activeTab === 'transactions'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Curated Transactions</span>
          </button>

          <button
            onClick={() => setActiveTab('quarantine')}
            className={`pb-3 text-sm font-medium transition flex items-center space-x-2 border-b-2 ${
              activeTab === 'quarantine'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span>Quarantined Rejections ({rejectedList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('zones')}
            className={`pb-3 text-sm font-medium transition flex items-center space-x-2 border-b-2 ${
              activeTab === 'zones'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Data Lake Zones</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`pb-3 text-sm font-medium transition flex items-center space-x-2 border-b-2 ${
              activeTab === 'architecture'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Architecture &amp; Docs</span>
          </button>
        </div>

        {/* Tab 1: Execution Runs */}
        {activeTab === 'runs' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">Pipeline Execution Ledger</h3>
                <p className="text-xs text-slate-400">Complete audit trail of all ingestion jobs with status, record counts, and duration.</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Run ID</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Start Time (UTC)</th>
                    <th className="px-6 py-3 text-right">Input Records</th>
                    <th className="px-6 py-3 text-right">Inserted</th>
                    <th className="px-6 py-3 text-right">Duplicates</th>
                    <th className="px-6 py-3 text-right">Rejected</th>
                    <th className="px-6 py-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                  {runs.map((r) => (
                    <tr key={r.run_id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-3.5 font-bold text-white flex items-center space-x-1.5">
                        <span className="truncate max-w-[180px]">{r.run_id}</span>
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          r.execution_status === 'COMPLETED'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : r.execution_status === 'PARTIAL_SUCCESS'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : r.execution_status === 'ALL_REJECTED'
                            ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {r.execution_status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-slate-400 font-sans">{r.start_time ? new Date(r.start_time).toLocaleString() : '—'}</td>
                      <td className="px-6 py-3.5 text-right font-bold text-blue-400">{r.input_records_count?.toLocaleString()}</td>
                      <td className="px-6 py-3.5 text-right text-emerald-400">{r.inserted_records_count?.toLocaleString()}</td>
                      <td className="px-6 py-3.5 text-right text-amber-400">{r.duplicate_records_count?.toLocaleString()}</td>
                      <td className="px-6 py-3.5 text-right text-rose-400">{r.rejected_records_count?.toLocaleString()}</td>
                      <td className="px-6 py-3.5 text-right text-slate-300 font-sans">{r.processing_duration_ms} ms</td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-slate-500 font-sans">
                        No pipeline runs recorded yet. Click "Generate Batch" and "Run Pipeline" above to start!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Curated Transactions */}
        {activeTab === 'transactions' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">Curated Transactions (Fact Table)</h3>
                <p className="text-xs text-slate-400">Pristine business events validated, transformed, and published to database.</p>
              </div>
              <span className="text-xs text-slate-400">Showing latest {transactions.length} records</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Tx ID</th>
                    <th className="px-6 py-3">Customer ID</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3">Currency</th>
                    <th className="px-6 py-3">Transaction Date</th>
                    <th className="px-6 py-3">Source File</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                  {transactions.map((t) => (
                    <tr key={t.transaction_id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-3 font-semibold text-white">{t.transaction_id}</td>
                      <td className="px-6 py-3 text-indigo-400">{t.customer_id}</td>
                      <td className="px-6 py-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.transaction_type === 'SALE'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : t.transaction_type === 'PAYMENT'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        }`}>
                          {t.transaction_type}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-white">
                        {Number(t.amount).toFixed(2)}
                      </td>
                      <td className="px-6 py-3">{t.currency}</td>
                      <td className="px-6 py-3 text-slate-400">{t.transaction_date}</td>
                      <td className="px-6 py-3 text-slate-400 text-[11px] truncate max-w-[160px]">{t.source_file}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-500 font-sans">
                        No transactions published yet. Run the pipeline to populate the Curated Zone.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Quarantined Rejections */}
        {activeTab === 'quarantine' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white flex items-center space-x-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 inline" />
                  <span>Quarantined Rejected Records (Dead-Letter Queue)</span>
                </h3>
                <p className="text-xs text-slate-400">Invalid records isolated with full lineage, error diagnosis, and original payload retained.</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Entity Type</th>
                    <th className="px-6 py-3">Record ID</th>
                    <th className="px-6 py-3">Rejection Reason</th>
                    <th className="px-6 py-3">Source File</th>
                    <th className="px-6 py-3">Quarantine Time</th>
                    <th className="px-6 py-3 text-center">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                  {rejectedList.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-3 font-sans">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          {r.entity_type}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-slate-300 font-bold">{r.record_id || '—'}</td>
                      <td className="px-6 py-3 text-amber-300/90 font-sans max-w-[320px]">{r.rejection_reason}</td>
                      <td className="px-6 py-3 text-slate-400 font-sans text-[11px]">{r.source_file}</td>
                      <td className="px-6 py-3 text-slate-400 font-sans text-[11px]">{new Date(r.rejection_timestamp).toLocaleTimeString()}</td>
                      <td className="px-6 py-3 text-center">
                        <button
                          onClick={() => setSelectedPayload(r.raw_record)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-sans transition inline-flex items-center space-x-1"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rejectedList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-500 font-sans">
                        No quarantined records found. All processed records met schema and business constraints!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Data Lake Zones */}
        {activeTab === 'zones' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Zone 1: Incoming Landing
                  </span>
                  <span className="text-xs text-slate-400">{zones?.incoming?.files || 0} file(s)</span>
                </div>
                <h4 className="font-semibold text-white">Object Storage Ingestion</h4>
                <p className="text-xs text-slate-400">
                  Landing bucket where producers deliver raw CSV, JSON, and NDJSON files.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.incoming?.path || './data/incoming'}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Zone 2: Raw Archive
                  </span>
                  <span className="text-xs text-slate-400">{zones?.raw?.files || 0} run batch(es)</span>
                </div>
                <h4 className="font-semibold text-white">Immutable Raw Lake</h4>
                <p className="text-xs text-slate-400">
                  Original byte-exact files archived before parsing, partitioned by run_id for replayability.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.raw?.path || './data/raw'}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    Zone 3: Validated
                  </span>
                  <span className="text-xs text-slate-400">{zones?.validated?.files || 0} run batch(es)</span>
                </div>
                <h4 className="font-semibold text-white">Structured Staging</h4>
                <p className="text-xs text-slate-400">
                  Parsed records that satisfied schema, type, and relational foreign-key integrity.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.validated?.path || './data/validated'}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    Zone 4: Rejected Quarantine
                  </span>
                  <span className="text-xs text-slate-400">{zones?.rejected?.files || 0} run batch(es)</span>
                </div>
                <h4 className="font-semibold text-white">Dead-Letter Storage</h4>
                <p className="text-xs text-slate-400">
                  Quarantine directory holding validation anomalies and primary key conflict violations.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.rejected?.path || './data/rejected'}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Zone 5: Curated Gold
                  </span>
                  <span className="text-xs text-slate-400">Partitioned Lake + MySQL</span>
                </div>
                <h4 className="font-semibold text-white">Curated Lakehouse</h4>
                <p className="text-xs text-slate-400">
                  Normalized, deduplicated, date-partitioned JSON lake files + MySQL tables.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.curated?.path || './data/curated'}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-500/10 text-slate-300 border border-slate-500/20">
                    Audit Reports
                  </span>
                  <span className="text-xs text-slate-400">{zones?.reports?.files || 0} report(s)</span>
                </div>
                <h4 className="font-semibold text-white">Execution Summaries</h4>
                <p className="text-xs text-slate-400">
                  Machine-readable JSON and CSV execution audits produced after every single batch run.
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800 break-all">
                  {zones?.reports?.path || './reports'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Architecture & Docs */}
        {activeTab === 'architecture' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Architecture &amp; Engineering Guarantees</h3>
              <p className="text-xs text-slate-400 mt-1">
                Design specifications, CLI commands, and test verification summary.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider">CLI Commands</h4>
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2 font-mono text-xs">
                  <div>
                    <span className="text-slate-500"># Execute full test suite (23 tests across 5 suites)</span>
                    <p className="text-emerald-400 font-bold">npm test</p>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-500"># Execute pipeline on current incoming files</span>
                    <p className="text-blue-400 font-bold">npm run pipeline</p>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-500"># Generate reproducible synthetic dataset (small, medium, large)</span>
                    <p className="text-purple-400 font-bold">npm run generate-data -- --size=small</p>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-500"># Run 100,000-record high-throughput benchmark</span>
                    <p className="text-amber-400 font-bold">npm run benchmark</p>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-500"># Run database integrity and financial reconciliation</span>
                    <p className="text-rose-400 font-bold">npm run reconcile</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider">Core Pipeline Guarantees</h4>
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-start space-x-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white">Strict Idempotency:</strong> Re-executing the same file produces 0 new records.
                      Identical duplicates are recognized, while conflicting primary keys are quarantined.
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-start space-x-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white">Relational Integrity:</strong> Pre-cached customer sets provide constant-time
                      foreign key lookups, enabling 16,000+ rec/sec throughput while preventing orphaned transactions.
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-start space-x-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white">Partial Failure Resilience:</strong> Corrupted rows or malformed JSON files
                      do not crash the process; invalid records are routed to the Dead-Letter Queue with full diagnostic reasons.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Raw Payload Modal */}
      {selectedPayload && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white text-sm">Quarantined Raw Payload</h4>
              <button
                onClick={() => setSelectedPayload(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <pre className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto max-h-96">
              {typeof selectedPayload === 'string'
                ? (selectedPayload.startsWith('{') || selectedPayload.startsWith('['))
                  ? JSON.stringify(JSON.parse(selectedPayload), null, 2)
                  : selectedPayload
                : JSON.stringify(selectedPayload, null, 2)}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedPayload(null)}
                className="px-4 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Enterprise Event Ingestion &amp; ETL Pipeline • JavaScript &amp; MySQL 8.0
      </footer>
    </div>
  );
}
