// ============================================================================
// AlAqsa — Excel import/export.
//
// Export: one client's full file, or the whole database (excluding sensitive
// documents/credentials, per the owner's requirement).
// Import: shop inventory, and clients/branches for bulk onboarding.
// ============================================================================

import ExcelJS from 'exceljs';
import path from 'node:path';
import { reportsDir } from '../storage/paths';
import { clientsRepo } from '../db/repositories/clientsRepo';
import { branchesRepo } from '../db/repositories/branchesRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { visitsRepo } from '../db/repositories/visitsRepo';
import { inventoryRepo, camLicenseRepo, invoicesRepo } from '../db/repositories/miscRepo';
import { DEVICE_TYPES, CLIENT_TYPES, VISIT_TYPES } from '@shared/constants';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F8A' },
};

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 22;
}

function autoWidth(sheet: ExcelJS.Worksheet): void {
  sheet.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = Math.min(len + 2, 50);
    });
    col.width = max;
  });
}

const arOf = (list: readonly { value: string; ar: string }[], v: string) =>
  list.find((x) => x.value === v)?.ar ?? v;

/** Export a single client's complete file. */
export async function exportClientExcel(clientId: string): Promise<string> {
  const client = clientsRepo.get(clientId);
  if (!client) throw new Error('CLIENT_NOT_FOUND');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AlAqsa';
  wb.created = new Date();

  // --- Overview ---
  const s1 = wb.addWorksheet('بيانات العميل', { views: [{ rightToLeft: true }] });
  s1.addRow(['البند', 'القيمة']);
  styleHeader(s1.getRow(1));
  const contacts = clientsRepo.contacts(clientId);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  [
    ['رمز العميل', client.code],
    ['الاسم (عربي)', client.nameAr],
    ['الاسم (إنجليزي)', client.nameEn ?? ''],
    ['النوع', arOf(CLIENT_TYPES, client.type)],
    ['التقييم', client.rating],
    ['عدد مرات التعامل', client.dealCount],
    ['عميل محذّر', client.isFlagged ? 'نعم' : 'لا'],
    ['سبب التحذير', client.flagReason ?? ''],
    ['جهة الاتصال الأساسية', primary?.name ?? ''],
    ['الهاتف', primary?.phones?.join(' / ') ?? ''],
    ['البريد الإلكتروني', primary?.emails?.join(' / ') ?? ''],
    ['ملاحظات', client.notes ?? ''],
  ].forEach((r) => s1.addRow(r));
  autoWidth(s1);

  // --- Contacts ---
  const s2 = wb.addWorksheet('جهات الاتصال', { views: [{ rightToLeft: true }] });
  s2.addRow(['الاسم', 'الصفة', 'الهواتف', 'الإيميلات', 'أساسي']);
  styleHeader(s2.getRow(1));
  contacts.forEach((c) => s2.addRow([
    c.name, c.role ?? '', c.phones.join(' / '), c.emails.join(' / '), c.isPrimary ? 'نعم' : 'لا',
  ]));
  autoWidth(s2);

  // --- Branches ---
  const branches = branchesRepo.listByClient(clientId);
  const s3 = wb.addWorksheet('الفروع', { views: [{ rightToLeft: true }] });
  s3.addRow(['م', 'اسم الفرع', 'الموقع', 'مسؤول الفرع', 'عدد الأجهزة', 'ملاحظات']);
  styleHeader(s3.getRow(1));
  branches.forEach((b, i) => s3.addRow([
    i + 1, b.nameAr, b.location.address ?? '', b.managerContact ?? '',
    devicesRepo.listByBranch(b.id).length, b.notes ?? '',
  ]));
  autoWidth(s3);

  // --- Devices ---
  const s4 = wb.addWorksheet('الأجهزة', { views: [{ rightToLeft: true }] });
  s4.addRow(['م', 'الفرع', 'النوع', 'الاسم/الرقم', 'الموقع داخل الفرع', 'الشركة', 'الموديل',
    'الرقم التسلسلي', 'السعة/القنوات', 'المصدر', 'تاريخ التركيب', 'انتهاء الضمان', 'الحالة', 'ملاحظات']);
  styleHeader(s4.getRow(1));
  let n = 0;
  for (const b of branches) {
    for (const d of devicesRepo.listByBranch(b.id)) {
      s4.addRow([
        ++n, b.nameAr, arOf(DEVICE_TYPES, d.type), d.label ?? '', d.positionInBranch ?? '',
        d.manufacturer ?? '', d.model ?? '', d.serialNumber ?? '',
        d.capacity ?? (d.channels ? `${d.channels} قناة` : ''),
        d.source === 'ours' ? 'من المحل' : 'خارجي',
        d.installDate ?? '', d.warrantyExpiry ?? '', d.health ?? '', d.notes ?? '',
      ]);
    }
  }
  autoWidth(s4);

  // --- Visits ---
  const s5 = wb.addWorksheet('الزيارات', { views: [{ rightToLeft: true }] });
  s5.addRow(['م', 'التاريخ', 'الفرع', 'النوع', 'الفني', 'الزيارة القادمة',
    'الأعطال', 'الإجراءات', 'التوصيات']);
  styleHeader(s5.getRow(1));
  visitsRepo.listByClient(clientId).forEach((v, i) => {
    const b = branches.find((x) => x.id === v.branchId);
    s5.addRow([
      i + 1, v.visitDate, b?.nameAr ?? '', arOf(VISIT_TYPES, v.type), v.technician ?? '',
      v.nextVisitDate ?? '', v.faultsFound ?? '', v.actionsTaken ?? '', v.recommendations ?? '',
    ]);
  });
  autoWidth(s5);

  // --- Licenses ---
  const licenses = camLicenseRepo.listByClient(clientId);
  if (licenses.length) {
    const s6 = wb.addWorksheet('رخص الكاميرات', { views: [{ rightToLeft: true }] });
    s6.addRow(['رقم الرخصة', 'تاريخ الإصدار', 'تاريخ التجديد', 'تاريخ الانتهاء', 'ملاحظات']);
    styleHeader(s6.getRow(1));
    licenses.forEach((l) => s6.addRow([
      l.licenseNumber ?? '', l.issueDate ?? '', l.renewalDate ?? '', l.expiryDate ?? '', l.notes ?? '',
    ]));
    autoWidth(s6);
  }

  // --- Invoices ---
  const invoices = invoicesRepo.listByClient(clientId);
  if (invoices.length) {
    const s7 = wb.addWorksheet('الفواتير', { views: [{ rightToLeft: true }] });
    s7.addRow(['رقم الفاتورة', 'التاريخ', 'الاستحقاق', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة']);
    styleHeader(s7.getRow(1));
    invoices.forEach((v) => s7.addRow([
      v.number, v.date, v.dueDate ?? '', v.total, v.paid, v.total - v.paid,
      v.status === 'paid' ? 'مدفوعة' : v.status === 'partial' ? 'جزئية' : 'غير مدفوعة',
    ]));
    autoWidth(s7);
  }

  const safe = client.nameAr.replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(reportsDir(), `بيانات-${safe}-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(out);
  return out;
}

/** Export the whole database (no documents, no credentials). */
export async function exportAllExcel(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AlAqsa';
  wb.created = new Date();

  const { rows: clients } = clientsRepo.list({ limit: 1000 });

  const s1 = wb.addWorksheet('العملاء', { views: [{ rightToLeft: true }] });
  s1.addRow(['م', 'الرمز', 'الاسم', 'النوع', 'التقييم', 'عدد التعاملات',
    'عدد الفروع', 'محذّر', 'سبب التحذير', 'ملاحظات']);
  styleHeader(s1.getRow(1));
  clients.forEach((c, i) => s1.addRow([
    i + 1, c.code, c.nameAr, arOf(CLIENT_TYPES, c.type), c.rating, c.dealCount,
    branchesRepo.countByClient(c.id), c.isFlagged ? 'نعم' : 'لا',
    c.flagReason ?? '', c.notes ?? '',
  ]));
  autoWidth(s1);

  const s2 = wb.addWorksheet('الفروع', { views: [{ rightToLeft: true }] });
  s2.addRow(['م', 'العميل', 'اسم الفرع', 'الموقع', 'مسؤول الفرع', 'عدد الأجهزة']);
  styleHeader(s2.getRow(1));
  let bn = 0;
  for (const c of clients) {
    for (const b of branchesRepo.listByClient(c.id)) {
      s2.addRow([++bn, c.nameAr, b.nameAr, b.location.address ?? '',
        b.managerContact ?? '', devicesRepo.listByBranch(b.id).length]);
    }
  }
  autoWidth(s2);

  const s3 = wb.addWorksheet('الأجهزة', { views: [{ rightToLeft: true }] });
  s3.addRow(['م', 'العميل', 'الفرع', 'النوع', 'الشركة', 'الموديل',
    'الرقم التسلسلي', 'المصدر', 'تاريخ التركيب', 'انتهاء الضمان', 'الحالة']);
  styleHeader(s3.getRow(1));
  let dn = 0;
  for (const c of clients) {
    for (const b of branchesRepo.listByClient(c.id)) {
      for (const d of devicesRepo.listByBranch(b.id)) {
        s3.addRow([++dn, c.nameAr, b.nameAr, arOf(DEVICE_TYPES, d.type),
          d.manufacturer ?? '', d.model ?? '', d.serialNumber ?? '',
          d.source === 'ours' ? 'من المحل' : 'خارجي',
          d.installDate ?? '', d.warrantyExpiry ?? '', d.health ?? '']);
      }
    }
  }
  autoWidth(s3);

  const s4 = wb.addWorksheet('المخزون', { views: [{ rightToLeft: true }] });
  s4.addRow(['م', 'النوع', 'الشركة', 'الموديل', 'الوصف', 'الكمية', 'سعر الوحدة']);
  styleHeader(s4.getRow(1));
  inventoryRepo.list().forEach((it, i) => s4.addRow([
    i + 1, arOf(DEVICE_TYPES, it.type), it.manufacturer ?? '', it.model ?? '',
    it.description ?? '', it.quantity ?? '', it.unitPrice ?? '',
  ]));
  autoWidth(s4);

  const out = path.join(reportsDir(), `تصدير-كامل-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(out);
  return out;
}

/**
 * Import shop inventory from Excel. Accepts Arabic or English headers and maps
 * them to inventory fields; unknown columns are ignored.
 */
export async function importInventoryExcel(sourcePath: string): Promise<{ imported: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('NO_SHEET');

  const headerRow = sheet.getRow(1);
  const cols: Record<string, number> = {};
  headerRow.eachCell((cell, col) => {
    const h = String(cell.value ?? '').trim().toLowerCase();
    const map: Record<string, string> = {
      'النوع': 'type', 'type': 'type',
      'الشركة': 'manufacturer', 'الشركة المصنعة': 'manufacturer', 'manufacturer': 'manufacturer', 'brand': 'manufacturer',
      'الموديل': 'model', 'model': 'model',
      'الوصف': 'description', 'description': 'description',
      'الكمية': 'quantity', 'quantity': 'quantity', 'qty': 'quantity',
      'سعر الوحدة': 'unitPrice', 'السعر': 'unitPrice', 'price': 'unitPrice', 'unit price': 'unitPrice',
    };
    if (map[h]) cols[map[h]] = col;
  });

  const typeByAr: Record<string, string> = {};
  DEVICE_TYPES.forEach((t) => { typeByAr[t.ar] = t.value; typeByAr[t.en.toLowerCase()] = t.value; });

  let imported = 0;
  sheet.eachRow((row, idx) => {
    if (idx === 1) return;
    const cell = (key: string) => (cols[key] ? String(row.getCell(cols[key]).value ?? '').trim() : '');
    const model = cell('model');
    const manufacturer = cell('manufacturer');
    if (!model && !manufacturer) return;
    const rawType = cell('type');
    const type = typeByAr[rawType] ?? typeByAr[rawType.toLowerCase()] ?? 'other';
    inventoryRepo.upsert({
      type: type as any,
      manufacturer: manufacturer || undefined,
      model: model || undefined,
      description: cell('description') || undefined,
      quantity: cell('quantity') ? Number(cell('quantity')) || undefined : undefined,
      unitPrice: cell('unitPrice') ? Number(cell('unitPrice')) || undefined : undefined,
    });
    imported++;
  });

  return { imported };
}
