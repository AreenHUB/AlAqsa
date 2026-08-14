// ============================================================================
// AlAqsa — Create/edit a maintenance visit.
//
// Mirrors the shop's paper form: branch header, 9-point checklist, per-camera
// checks, replaced parts (old/new serial), the narrative report, and signatures
// captured by drawing on a canvas.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextInput, TextArea, Select, Checkbox, useToast, useErrorMessage, Badge } from './ui';
import { SignaturePad } from './SignaturePad';
import { TechnicianPicker } from './TechnicianPicker';
import { VISIT_TYPES } from '@shared/constants';
import { todayISO, addDays } from '../utils/validation';
import type {
  Visit, Branch, Device, MaintenanceChecklist, CameraCheck, ReplacedPart,
  MediaRef, StaffMember, AmcContract,
} from '@shared/types';

const CHECKLIST_KEYS: (keyof MaintenanceChecklist)[] = [
  'cleanCameras', 'cleanNvr', 'checkNetworkCables', 'checkPowerSupply',
  'testRecordPlayback', 'setDateTime', 'updateFirmware', 'testRemoteView',
  'checkStorageSpace',
];

const EMPTY_CHECKLIST: MaintenanceChecklist = {
  cleanCameras: false, cleanNvr: false, checkNetworkCables: false,
  checkPowerSupply: false, testRecordPlayback: false, setDateTime: false,
  updateFirmware: false, testRemoteView: false, checkStorageSpace: false,
};

export function VisitFormModal({
  open, clientId, visit, branches, devices, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  visit: Visit | null;
  branches: Branch[];
  devices: Device[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [branchId, setBranchId] = useState('');
  const [type, setType] = useState('maintenance');
  const [visitDate, setVisitDate] = useState(todayISO());
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [technician, setTechnician] = useState('');
  const [technicianId, setTechnicianId] = useState<string | undefined>();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contracts, setContracts] = useState<AmcContract[]>([]);
  const [amcContractId, setAmcContractId] = useState('');
  const [countsAgainstAmc, setCountsAgainstAmc] = useState(true);
  const [checklist, setChecklist] = useState<MaintenanceChecklist>(EMPTY_CHECKLIST);
  const [cameraChecks, setCameraChecks] = useState<CameraCheck[]>([]);
  const [parts, setParts] = useState<ReplacedPart[]>([]);
  const [faults, setFaults] = useState('');
  const [actions, setActions] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [sigTech, setSigTech] = useState<MediaRef | undefined>();
  const [sigClient, setSigClient] = useState<MediaRef | undefined>();
  const [makeReminder, setMakeReminder] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<'info' | 'checklist' | 'cameras' | 'parts' | 'report'>('info');

  const loadStaff = useCallback(async () => {
    const s = await window.alaqsa.staff.list();
    if (s.ok) setStaff(s.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStaff();
    // AMC contracts are only readable by roles allowed to see money; a refusal
    // here simply means no contract picker is offered.
    void window.alaqsa.amc.listByClient(clientId).then((r) => {
      setContracts(r.ok ? r.data : []);
    });

    if (visit) {
      setBranchId(visit.branchId);
      setType(visit.type);
      setVisitDate(visit.visitDate.slice(0, 10));
      setNextVisitDate(visit.nextVisitDate?.slice(0, 10) ?? '');
      setTechnician(visit.technician ?? '');
      setTechnicianId(visit.technicianId);
      setAmcContractId(visit.amcContractId ?? '');
      setCountsAgainstAmc(visit.countsAgainstAmc !== false);
      setChecklist({ ...EMPTY_CHECKLIST, ...visit.checklist });
      setCameraChecks(visit.cameraChecks);
      setParts(visit.replacedParts);
      setFaults(visit.faultsFound ?? '');
      setActions(visit.actionsTaken ?? '');
      setRecommendations(visit.recommendations ?? '');
      setSigTech(visit.signatureTechnician);
      setSigClient(visit.signatureClient);
      setMakeReminder(false);
    } else {
      setBranchId(branches[0]?.id ?? '');
      setType('maintenance');
      setVisitDate(todayISO());
      setNextVisitDate(addDays(todayISO(), 90));
      setTechnician('');
      setTechnicianId(undefined);
      setAmcContractId('');
      setCountsAgainstAmc(true);
      setChecklist(EMPTY_CHECKLIST);
      setCameraChecks([]);
      setParts([]);
      setFaults(''); setActions(''); setRecommendations('');
      setSigTech(undefined); setSigClient(undefined);
      setMakeReminder(true);
    }
    setErrors({});
    setSection('info');
  }, [open, visit, branches]);

  /** Cameras belonging to the selected branch. */
  const branchCameras = useMemo(
    () => devices.filter((d) => d.branchId === branchId && d.type === 'camera'),
    [devices, branchId],
  );

  // Keep a check row for every camera in the branch.
  useEffect(() => {
    if (!open) return;
    setCameraChecks((prev) => branchCameras.map((cam) => {
      const existing = prev.find((c) => c.deviceId === cam.id);
      return existing ?? {
        deviceId: cam.id, status: 'ok',
        lensCleaned: false, imageChecked: false, networkChecked: false,
      };
    }));
  }, [branchCameras, open]);

  const setCheck = (deviceId: string, patch: Partial<CameraCheck>) => {
    setCameraChecks((prev) => prev.map((c) => (c.deviceId === deviceId ? { ...c, ...patch } : c)));
  };

  const allChecklistDone = CHECKLIST_KEYS.every((k) => checklist[k]);
  const toggleAllChecklist = () => {
    const next = !allChecklistDone;
    setChecklist(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, next])) as unknown as MaintenanceChecklist);
  };

  const markAllCameras = () => {
    setCameraChecks((prev) => prev.map((c) => ({
      ...c, lensCleaned: true, imageChecked: true, networkChecked: true,
    })));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!branchId) e.branchId = t.validation.required;
    if (!visitDate) e.visitDate = t.validation.required;
    if (nextVisitDate && nextVisitDate < visitDate) e.nextVisitDate = t.validation.dateOrder;
    setErrors(e);
    if (Object.keys(e).length) { setSection('info'); return; }

    setBusy(true);
    const payload: Partial<Visit> = {
      clientId, branchId,
      type: type as Visit['type'],
      visitDate, nextVisitDate: nextVisitDate || undefined,
      technician: technician.trim() || undefined,
      technicianId,
      amcContractId: amcContractId || undefined,
      countsAgainstAmc: amcContractId ? countsAgainstAmc : false,
      checklist,
      cameraChecks,
      replacedParts: parts.filter((p) => p.description.trim()),
      faultsFound: faults.trim() || undefined,
      actionsTaken: actions.trim() || undefined,
      recommendations: recommendations.trim() || undefined,
      signatureTechnician: sigTech,
      signatureClient: sigClient,
      photosBefore: [], photosAfter: [],
    };

    const res = visit
      ? await window.alaqsa.visits.update(visit.id, payload)
      : await window.alaqsa.visits.create(payload);

    if (!res.ok) { setBusy(false); return toast.error(errMsg(res.error)); }

    // Optionally create a reminder for the next visit.
    if (makeReminder && nextVisitDate) {
      const branch = branches.find((b) => b.id === branchId);
      await window.alaqsa.reminders.save({
        kind: 'maintenance_due',
        clientId, branchId,
        title: `${t.reminders.kinds.maintenance_due} — ${branch?.nameAr ?? ''}`,
        dueDate: nextVisitDate,
        leadDays: 7,
      });
    }

    setBusy(false);
    toast.success(visit ? t.msg.updated : t.msg.created);
    onSaved();
  };

  const saveSignature = async (dataUrl: string, who: 'tech' | 'client') => {
    const res = await window.alaqsa.files.saveDataUrl(dataUrl, `signature-${who}-${Date.now()}.png`);
    if (!res.ok) return toast.error(errMsg(res.error));
    if (who === 'tech') setSigTech(res.data); else setSigClient(res.data);
    toast.success(t.msg.saved);
  };

  const doneCount = CHECKLIST_KEYS.filter((k) => checklist[k]).length;

  const sections = [
    { id: 'info' as const, label: t.common.details },
    { id: 'checklist' as const, label: `${t.visits.checklist} (${doneCount}/9)` },
    { id: 'cameras' as const, label: `${t.visits.cameraChecks} (${branchCameras.length})` },
    { id: 'parts' as const, label: `${t.visits.replacedParts} (${parts.length})` },
    { id: 'report' as const, label: t.visits.report },
  ];

  return (
    <Modal
      open={open}
      title={visit ? t.visits.editVisit : t.visits.newVisit}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : t.common.save}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        {/* Section switcher */}
        <div className="tabs">
          {sections.map((s) => (
            <button key={s.id} className={`tab ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </div>

        {/* ---- Info ---- */}
        {section === 'info' && (
          <div className="form-grid">
            <Field label={t.branches.title} required error={errors.branchId}>
              <Select
                value={branchId}
                onChange={setBranchId}
                placeholder={t.common.selectOption}
                options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
                error={!!errors.branchId}
              />
            </Field>
            <Field label={t.visits.visitType} required>
              <Select
                value={type}
                onChange={setType}
                options={VISIT_TYPES.map((v) => ({ value: v.value, label: lang === 'ar' ? v.ar : v.en }))}
              />
            </Field>
            <Field label={t.visits.visitDate} required error={errors.visitDate}>
              <TextInput value={visitDate} onChange={setVisitDate} type="date" error={!!errors.visitDate} />
            </Field>
            <Field label={t.visits.technician}>
              <TechnicianPicker
                value={technician}
                staffId={technicianId}
                staff={staff}
                onChange={(name, id) => { setTechnician(name); setTechnicianId(id); }}
                onStaffAdded={loadStaff}
              />
            </Field>
            <Field label={t.visits.nextVisitDate} error={errors.nextVisitDate}>
              <TextInput value={nextVisitDate} onChange={setNextVisitDate} type="date"
                error={!!errors.nextVisitDate} />
            </Field>

            {/* Maintenance contract. Linking here is what decrements the
                contract's remaining visits — the counter is never typed. */}
            {contracts.length > 0 && (
              <>
                <Field label={t.finance.amc} className="span-2">
                  <Select
                    value={amcContractId}
                    onChange={setAmcContractId}
                    placeholder={t.visits.noContract}
                    options={contracts.map((c) => ({
                      value: c.id,
                      label: c.unlimitedVisits
                        ? `${c.startDate} → ${c.endDate} · ${t.finance.unlimited}`
                        : `${c.startDate} → ${c.endDate} · ${c.totalVisits - c.usedVisits}/${c.totalVisits}`,
                    }))}
                  />
                </Field>
                {amcContractId && (
                  <div className="span-all">
                    <Checkbox
                      checked={countsAgainstAmc}
                      onChange={setCountsAgainstAmc}
                      label={t.visits.countsAgainstAmc}
                    />
                    <div className="field-hint">{t.visits.countsHint}</div>
                  </div>
                )}
              </>
            )}

            <div className="span-all">
              <Checkbox checked={makeReminder} onChange={setMakeReminder}
                label={`🔔 ${t.visits.addReminder}`} />
            </div>
          </div>
        )}

        {/* ---- Checklist ---- */}
        {section === 'checklist' && (
          <div className="col gap-10">
            <div className="row between">
              <Badge kind={doneCount === 9 ? 'success' : 'warning'}>✓ {doneCount}/9</Badge>
              <button className="btn btn-outline btn-sm" onClick={toggleAllChecklist}>
                {allChecklistDone ? '✕ ' + t.common.none : '✓ ' + t.common.all}
              </button>
            </div>
            <div className="col gap-2">
              {CHECKLIST_KEYS.map((key) => (
                <label key={key} className="check" style={{
                  padding: '10px 13px', borderRadius: 'var(--radius)',
                  background: checklist[key] ? 'var(--success-bg)' : 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  transition: 'background 140ms',
                }}>
                  <input
                    type="checkbox"
                    checked={checklist[key]}
                    onChange={(e) => setChecklist((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  <span>{t.visits.checklistItems[key]}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ---- Camera checks ---- */}
        {section === 'cameras' && (
          <div className="col gap-10">
            {branchCameras.length === 0 ? (
              <div className="empty"><div className="empty-icon">📷</div>
                <div className="small muted">{t.devices.noDevices}</div></div>
            ) : (
              <>
                <div className="row between">
                  <span className="small muted">{branchCameras.length} {t.dashboard.cameras}</span>
                  <button className="btn btn-outline btn-sm" onClick={markAllCameras}>
                    ✓ {t.common.all}
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.devices.label}</th>
                        <th>{t.devices.positionInBranch}</th>
                        <th>{t.visits.cameraStatus}</th>
                        <th style={{ textAlign: 'center' }}>{t.visits.lensCleaned}</th>
                        <th style={{ textAlign: 'center' }}>{t.visits.imageChecked}</th>
                        <th style={{ textAlign: 'center' }}>{t.visits.networkChecked}</th>
                        <th>{t.common.notes}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchCameras.map((cam) => {
                        const chk = cameraChecks.find((c) => c.deviceId === cam.id);
                        if (!chk) return null;
                        return (
                          <tr key={cam.id}>
                            <td className="small bold">{cam.label ?? '—'}</td>
                            <td className="small">{cam.positionInBranch ?? '—'}</td>
                            <td>
                              <select
                                className="select"
                                style={{ minHeight: 30, padding: '3px 8px', fontSize: 12 }}
                                value={chk.status}
                                onChange={(e) => setCheck(cam.id, { status: e.target.value as CameraCheck['status'] })}
                              >
                                <option value="ok">{t.visits.statusOk}</option>
                                <option value="needs_service">{t.visits.statusNeedsService}</option>
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input type="checkbox" checked={chk.lensCleaned}
                                onChange={(e) => setCheck(cam.id, { lensCleaned: e.target.checked })} />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input type="checkbox" checked={chk.imageChecked}
                                onChange={(e) => setCheck(cam.id, { imageChecked: e.target.checked })} />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input type="checkbox" checked={chk.networkChecked}
                                onChange={(e) => setCheck(cam.id, { networkChecked: e.target.checked })} />
                            </td>
                            <td>
                              <input
                                className="input"
                                style={{ minHeight: 30, fontSize: 12 }}
                                value={chk.notes ?? ''}
                                onChange={(e) => setCheck(cam.id, { notes: e.target.value })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- Replaced parts ---- */}
        {section === 'parts' && (
          <div className="col gap-10">
            <div className="row between">
              <span className="small muted">{parts.length} {t.visits.replacedParts}</span>
              <button className="btn btn-outline btn-sm"
                onClick={() => setParts((p) => [...p, {
                  id: `p${Date.now()}`, description: '', oldSerial: '', newSerial: '', reason: '',
                }])}>
                + {t.visits.addPart}
              </button>
            </div>
            {parts.length === 0 ? (
              <div className="empty" style={{ padding: 32 }}>
                <div className="empty-icon">🔧</div>
                <div className="small muted">{t.common.noData}</div>
              </div>
            ) : parts.map((p, i) => (
              <div key={p.id} className="card">
                <div className="card-body" style={{ padding: 13 }}>
                  <div className="row between mb-8">
                    <span className="tiny bold muted">#{i + 1}</span>
                    <button className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  <div className="form-grid">
                    <Field label={t.visits.partDescription}>
                      <TextInput value={p.description}
                        onChange={(v) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
                    </Field>
                    <Field label={t.visits.reason}>
                      <TextInput value={p.reason ?? ''}
                        onChange={(v) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, reason: v } : x)))} />
                    </Field>
                    <Field label={t.visits.oldSerial}>
                      <TextInput value={p.oldSerial ?? ''} dir="ltr" className="input mono"
                        onChange={(v) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, oldSerial: v } : x)))} />
                    </Field>
                    <Field label={t.visits.newSerial}>
                      <TextInput value={p.newSerial ?? ''} dir="ltr" className="input mono"
                        onChange={(v) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, newSerial: v } : x)))} />
                    </Field>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Report + signatures ---- */}
        {section === 'report' && (
          <div className="col gap-16">
            <Field label={t.visits.faultsFound}>
              <TextArea value={faults} onChange={setFaults} rows={3} />
            </Field>
            <Field label={t.visits.actionsTaken}>
              <TextArea value={actions} onChange={setActions} rows={3} />
            </Field>
            <Field label={t.visits.recommendations}>
              <TextArea value={recommendations} onChange={setRecommendations} rows={3} />
            </Field>

            <div className="form-section-title">{t.visits.approval}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              <SignaturePad
                label={t.visits.signatureTech}
                saved={!!sigTech}
                onSave={(d) => saveSignature(d, 'tech')}
                onClear={() => setSigTech(undefined)}
              />
              <SignaturePad
                label={t.visits.signatureClient}
                saved={!!sigClient}
                onSave={(d) => saveSignature(d, 'client')}
                onClear={() => setSigClient(undefined)}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
