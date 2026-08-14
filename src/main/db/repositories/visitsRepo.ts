// ============================================================================
// AlAqsa — Visits repository. Mirrors the source maintenance form: 9-point
// checklist, per-camera checks, replaced parts, faults/actions/recommendations,
// signatures and before/after photos.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, parseJson } from '../helpers';
import type { Visit, MaintenanceChecklist, CameraCheck, ReplacedPart, MediaRef } from '@shared/types';

const EMPTY_CHECKLIST: MaintenanceChecklist = {
  cleanCameras: false, cleanNvr: false, checkNetworkCables: false,
  checkPowerSupply: false, testRecordPlayback: false, setDateTime: false,
  updateFirmware: false, testRemoteView: false, checkStorageSpace: false,
};

interface VisitRow {
  id: string; client_id: string; branch_id: string; type: string;
  visit_date: string; next_visit_date: string | null; technician: string | null;
  technician_id: string | null; amc_contract_id: string | null;
  counts_against_amc: number;
  checklist: string; camera_checks: string; replaced_parts: string;
  faults_found: string | null; actions_taken: string | null; recommendations: string | null;
  signature_tech_media_id: string | null; signature_client_media_id: string | null;
  photos_before: string; photos_after: string;
  created_at: string; updated_at: string;
}

function media(id: string | null): MediaRef | undefined {
  if (!id) return undefined;
  const r = getDb().prepare('SELECT * FROM media WHERE id = ?').get(id) as any;
  if (!r) return undefined;
  return {
    id: r.id, fileName: r.file_name, storedPath: r.stored_path,
    mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at,
  };
}

function mediaList(ids: string[]): MediaRef[] {
  return ids.map((id) => media(id)).filter((m): m is MediaRef => !!m);
}

function mapVisit(r: VisitRow): Visit {
  return {
    id: r.id, clientId: r.client_id, branchId: r.branch_id,
    type: r.type as Visit['type'], visitDate: r.visit_date,
    nextVisitDate: r.next_visit_date ?? undefined, technician: r.technician ?? undefined,
    technicianId: r.technician_id ?? undefined,
    amcContractId: r.amc_contract_id ?? undefined,
    countsAgainstAmc: r.counts_against_amc !== 0,
    checklist: { ...EMPTY_CHECKLIST, ...parseJson<Partial<MaintenanceChecklist>>(r.checklist, {}) },
    cameraChecks: parseJson<CameraCheck[]>(r.camera_checks, []),
    replacedParts: parseJson<ReplacedPart[]>(r.replaced_parts, []),
    faultsFound: r.faults_found ?? undefined, actionsTaken: r.actions_taken ?? undefined,
    recommendations: r.recommendations ?? undefined,
    signatureTechnician: media(r.signature_tech_media_id),
    signatureClient: media(r.signature_client_media_id),
    photosBefore: mediaList(parseJson<string[]>(r.photos_before, [])),
    photosAfter: mediaList(parseJson<string[]>(r.photos_after, [])),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const visitsRepo = {
  listByClient(clientId: string): Visit[] {
    const rows = getDb().prepare('SELECT * FROM visits WHERE client_id = ? ORDER BY visit_date DESC').all(clientId) as VisitRow[];
    return rows.map(mapVisit);
  },

  listByBranch(branchId: string): Visit[] {
    const rows = getDb().prepare('SELECT * FROM visits WHERE branch_id = ? ORDER BY visit_date DESC').all(branchId) as VisitRow[];
    return rows.map(mapVisit);
  },

  get(id: string): Visit | null {
    const r = getDb().prepare('SELECT * FROM visits WHERE id = ?').get(id) as VisitRow | undefined;
    return r ? mapVisit(r) : null;
  },

  create(input: Partial<Visit>): Visit {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    db.prepare(`INSERT INTO visits
      (id, client_id, branch_id, type, visit_date, next_visit_date, technician,
       technician_id, amc_contract_id, counts_against_amc, checklist,
       camera_checks, replaced_parts, faults_found, actions_taken, recommendations,
       signature_tech_media_id, signature_client_media_id, photos_before, photos_after,
       created_at, updated_at)
      VALUES (@id,@client_id,@branch_id,@type,@visit_date,@next_visit_date,@technician,
       @technician_id,@amc_contract_id,@counts_against_amc,@checklist,
       @camera_checks,@replaced_parts,@faults_found,@actions_taken,@recommendations,
       @sig_tech,@sig_client,@photos_before,@photos_after,@created_at,@updated_at)`)
      .run({
        id, client_id: input.clientId, branch_id: input.branchId,
        type: input.type ?? 'maintenance',
        visit_date: input.visitDate ?? ts.slice(0, 10),
        next_visit_date: input.nextVisitDate ?? null, technician: input.technician ?? null,
        technician_id: input.technicianId ?? null,
        amc_contract_id: input.amcContractId ?? null,
        counts_against_amc: input.countsAgainstAmc === false ? 0 : 1,
        checklist: JSON.stringify({ ...EMPTY_CHECKLIST, ...(input.checklist ?? {}) }),
        camera_checks: JSON.stringify(input.cameraChecks ?? []),
        replaced_parts: JSON.stringify(input.replacedParts ?? []),
        faults_found: input.faultsFound ?? null, actions_taken: input.actionsTaken ?? null,
        recommendations: input.recommendations ?? null,
        sig_tech: input.signatureTechnician?.id ?? null,
        sig_client: input.signatureClient?.id ?? null,
        photos_before: JSON.stringify((input.photosBefore ?? []).map((m) => m.id)),
        photos_after: JSON.stringify((input.photosAfter ?? []).map((m) => m.id)),
        created_at: ts, updated_at: ts,
      });
    // Each recorded visit counts as a dealing with the client.
    db.prepare('UPDATE clients SET deal_count = deal_count + 1, updated_at = ? WHERE id = ?')
      .run(ts, input.clientId);
    return this.get(id)!;
  },

  update(id: string, patch: Partial<Visit>): Visit {
    const existing = this.get(id);
    if (!existing) throw new Error('NOT_FOUND');
    const m = { ...existing, ...patch, updatedAt: now() };
    getDb().prepare(`UPDATE visits SET
      type=@type, visit_date=@visit_date, next_visit_date=@next_visit_date, technician=@technician,
      technician_id=@technician_id, amc_contract_id=@amc_contract_id,
      counts_against_amc=@counts_against_amc,
      checklist=@checklist, camera_checks=@camera_checks, replaced_parts=@replaced_parts,
      faults_found=@faults_found, actions_taken=@actions_taken, recommendations=@recommendations,
      signature_tech_media_id=@sig_tech, signature_client_media_id=@sig_client,
      photos_before=@photos_before, photos_after=@photos_after, updated_at=@updated_at
      WHERE id=@id`)
      .run({
        id, type: m.type, visit_date: m.visitDate, next_visit_date: m.nextVisitDate ?? null,
        technician: m.technician ?? null,
        technician_id: m.technicianId ?? null,
        amc_contract_id: m.amcContractId ?? null,
        counts_against_amc: m.countsAgainstAmc === false ? 0 : 1,
        checklist: JSON.stringify(m.checklist),
        camera_checks: JSON.stringify(m.cameraChecks), replaced_parts: JSON.stringify(m.replacedParts),
        faults_found: m.faultsFound ?? null, actions_taken: m.actionsTaken ?? null,
        recommendations: m.recommendations ?? null,
        sig_tech: m.signatureTechnician?.id ?? null, sig_client: m.signatureClient?.id ?? null,
        photos_before: JSON.stringify(m.photosBefore.map((p) => p.id)),
        photos_after: JSON.stringify(m.photosAfter.map((p) => p.id)),
        updated_at: m.updatedAt,
      });
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM visits WHERE id = ?').run(id);
  },

  countThisMonth(): number {
    const start = new Date();
    const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    return (getDb().prepare('SELECT count(*) AS c FROM visits WHERE visit_date >= ?').get(from) as { c: number }).c;
  },
};
