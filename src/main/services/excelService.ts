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
import { getDb } from '../db/database';
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

// ---------------------------------------------------------------------------
// Inventory import
//
// Two shapes of file have to work:
//
//  A. A simple sheet the owner types himself — headers on row 1, one column per
//     inventory field (النوع / الموديل / الكمية / السعر …).
//
//  B. A stock report exported from the shop's accounting program. Those have a
//     letterhead above the real header row, Arabic movement columns rather than
//     a plain "quantity", and a totals row at the bottom. The header is found by
//     scanning instead of assuming row 1, so the letterhead does not break it.
//
// Neither shape carries a device type, so the type is inferred from the item
// name when the column is absent — otherwise all 500+ rows land in "أخرى" and
// the filters on the inventory screen become useless.
// ---------------------------------------------------------------------------

/** Header text -> inventory field. Compared lowercased with spaces collapsed. */
const INVENTORY_HEADERS: Record<string, string> = {
  // type
  'النوع': 'type', 'type': 'type', 'الصنف': 'type', 'category': 'type',
  // manufacturer
  'الشركة': 'manufacturer', 'الشركة المصنعة': 'manufacturer', 'الماركة': 'manufacturer',
  'manufacturer': 'manufacturer', 'brand': 'manufacturer',
  // model / name — accounting exports call this simply "الاسم"
  'الموديل': 'model', 'model': 'model', 'الاسم': 'model', 'اسم الصنف': 'model',
  'المادة': 'model', 'اسم المادة': 'model', 'name': 'model', 'item': 'model',
  'item name': 'model', 'description of goods': 'model',
  // description
  'الوصف': 'description', 'description': 'description', 'ملاحظات': 'description',
  // plain quantity
  'الكمية': 'quantity', 'quantity': 'quantity', 'qty': 'quantity',
  'الرصيد': 'quantity', 'الكمية المتوفرة': 'quantity', 'balance': 'quantity',
  'stock': 'quantity',
  // unit price
  'سعر الوحدة': 'unitPrice', 'السعر': 'unitPrice', 'price': 'unitPrice',
  'unit price': 'unitPrice', 'سعر المفرق': 'unitPrice', 'سعر البيع': 'unitPrice',
  // --- movement columns (accounting exports) ---
  'كميةرصيد البداية': 'openingQty', 'كمية رصيد البداية': 'openingQty',
  'كميةالادخالات': 'inQty', 'كمية الادخالات': 'inQty', 'كميةالإدخالات': 'inQty',
  'قيمةالادخالات': 'inValue', 'قيمة الادخالات': 'inValue', 'قيمةالإدخالات': 'inValue',
  'كميةالاخراجات': 'outQty', 'كمية الاخراجات': 'outQty', 'كميةالإخراجات': 'outQty',
  'كمية الشراء': 'purchaseQty', 'قيمة الشراء': 'purchaseValue',
  'الحد الأدنى': 'minQty', 'الحد الادنى': 'minQty',
  // row number column, recognised so it is never mistaken for data
  'الرقم': 'rowNo', '#': 'rowNo', 'no': 'rowNo', 'no.': 'rowNo',
};

/**
 * Guess a device type from the item name. Order matters: the more specific
 * patterns are tested first, so "POE SWITCH" is a poe_switch and not a switch,
 * and a "CAMERA CABLE" is not counted as a camera.
 */
const TYPE_PATTERNS: Array<[string, RegExp]> = [
  ['other', /\bCABLE\b|\bWIRE\b|كيبل|كابل|سلك/i],
  ['nvr', /\bNVR\b/i],
  ['dvr', /\bDVR\b|\bXVR\b|\bHVR\b/i],
  ['poe_switch', /\bPOE\b/i],
  ['switch', /\bSWITCH\b|سويتش|سويچ/i],
  ['router', /\bROUTER\b|راوتر|\bACCESS\s*POINT\b|\bREPEATER\b|\bMODEM\b/i],
  ['ups', /\bUPS\b|\bBATTERY\s*BACKUP\b/i],
  ['hdd', /\bHDD\b|\bHARD\b|\bSSD\b|قرص صلب|هارد/i],
  ['camera', /\bCAMERA\b|\bCAM\b|كاميرا|\bBALLON\b|\bBULLET\b|\bDOME\b|\bIPC\b|\bPTZ\b|\b\d+\s*MP\b/i],
];

function guessDeviceType(name: string): string {
  for (const [type, re] of TYPE_PATTERNS) if (re.test(name)) return type;
  return 'other';
}

/** Normalise a header cell for lookup. */
function normHeader(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Read a cell as a number, tolerating formulas, blanks and stray text. */
function cellNumber(cell: ExcelJS.Cell): number {
  const v: any = cell.value;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    const inner = v.result ?? v.text;
    const n = Number(inner);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Read a cell as trimmed display text. */
function cellText(cell: ExcelJS.Cell): string {
  const v: any = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    return String(v.text ?? v.result ?? '').trim();
  }
  return String(v).trim();
}

/**
 * Find the header row. Accounting exports put a shop letterhead on the first
 * few rows, so row 1 cannot be assumed. The winning row is the one matching the
 * most known headers, and it must contain an item-name column to be usable.
 */
function findHeaderRow(sheet: ExcelJS.Worksheet): { row: number; cols: Record<string, number> } {
  let best = { row: 0, cols: {} as Record<string, number>, score: 0 };
  const limit = Math.min(sheet.rowCount, 30);

  for (let r = 1; r <= limit; r++) {
    const cols: Record<string, number> = {};
    let score = 0;
    sheet.getRow(r).eachCell((cell, col) => {
      const field = INVENTORY_HEADERS[normHeader(cell.value)];
      // First match wins, so a duplicated header cannot overwrite the real one.
      if (field && cols[field] === undefined) { cols[field] = col; score++; }
    });
    if (score > best.score) best = { row: r, cols, score };
  }

  if (!best.score || best.cols.model === undefined) throw new Error('NO_HEADER_ROW');
  return { row: best.row, cols: best.cols };
}

export interface InventoryImportResult {
  imported: number;
  updated: number;
  skipped: number;
  /** Rows whose computed stock was negative in the source file. */
  negativeStock: number;
  headerRow: number;
}

/**
 * Import shop inventory from Excel. Existing items are matched by name so the
 * same file can be re-imported after a stock-take without creating duplicates.
 */
export async function importInventoryExcel(sourcePath: string): Promise<InventoryImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('NO_SHEET');

  const { row: headerRow, cols } = findHeaderRow(sheet);

  const typeByName: Record<string, string> = {};
  DEVICE_TYPES.forEach((t) => {
    typeByName[t.ar] = t.value;
    typeByName[t.en.toLowerCase()] = t.value;
    typeByName[t.value] = t.value;
  });

  // Match on name so a re-import updates rather than duplicates.
  const existing = new Map<string, string>();
  for (const item of inventoryRepo.list()) {
    const key = (item.model ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (key) existing.set(key, item.id);
  }

  const result: InventoryImportResult = {
    imported: 0, updated: 0, skipped: 0, negativeStock: 0, headerRow,
  };

  // Hundreds of rows: one transaction keeps it fast and all-or-nothing, so a
  // bad row halfway down cannot leave the inventory partly imported.
  const runImport = getDb().transaction(() => {
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const at = (field: string) => (cols[field] !== undefined ? row.getCell(cols[field]) : null);

    const nameCell = at('model');
    const model = nameCell ? cellText(nameCell) : '';
    const manufacturer = at('manufacturer') ? cellText(at('manufacturer')!) : '';
    if (!model && !manufacturer) { result.skipped++; continue; }

    // The trailing totals row carries a label but no item identity.
    if (/^(الاجمالي|الإجمالي|المجموع|total|grand total)$/i.test(model)) { result.skipped++; continue; }

    // Printed reports repeat their column headers at the top of every page.
    // Those rows look like data, so drop any row whose name cell is itself a
    // known header — otherwise "الاسم" is inserted as an inventory item.
    if (INVENTORY_HEADERS[normHeader(model)] !== undefined) { result.skipped++; continue; }

    // --- quantity ---------------------------------------------------------
    // A plain quantity column wins. Otherwise reconstruct the closing balance
    // from the movement columns: opening + entries - exits.
    let quantity: number | undefined;
    if (cols.quantity !== undefined) {
      quantity = cellNumber(at('quantity')!);
    } else if (cols.inQty !== undefined || cols.outQty !== undefined || cols.openingQty !== undefined) {
      const opening = cols.openingQty !== undefined ? cellNumber(at('openingQty')!) : 0;
      const entries = cols.inQty !== undefined ? cellNumber(at('inQty')!) : 0;
      const exits = cols.outQty !== undefined ? cellNumber(at('outQty')!) : 0;
      const balance = opening + entries - exits;
      if (balance < 0) {
        // The source export is inconsistent for this item (more went out than
        // ever came in). Record it as zero rather than inventing a number, and
        // report the count so the owner knows which figures to re-check.
        result.negativeStock++;
        quantity = 0;
      } else {
        quantity = balance;
      }
    }

    // --- unit price -------------------------------------------------------
    // Prefer an explicit price; otherwise derive the average cost actually paid
    // (value of entries / quantity of entries).
    let unitPrice: number | undefined;
    if (cols.unitPrice !== undefined) {
      unitPrice = cellNumber(at('unitPrice')!) || undefined;
    } else {
      const valueCol = cols.inValue !== undefined ? 'inValue' : (cols.purchaseValue !== undefined ? 'purchaseValue' : null);
      const qtyCol = cols.inQty !== undefined ? 'inQty' : (cols.purchaseQty !== undefined ? 'purchaseQty' : null);
      if (valueCol && qtyCol) {
        const value = cellNumber(at(valueCol)!);
        const qty = cellNumber(at(qtyCol)!);
        if (value > 0 && qty > 0) unitPrice = Math.round((value / qty) * 100) / 100;
      }
    }

    // --- type -------------------------------------------------------------
    const rawType = cols.type !== undefined ? cellText(at('type')!) : '';
    const type = typeByName[rawType] ?? typeByName[rawType.toLowerCase()]
      ?? guessDeviceType(`${model} ${manufacturer}`);

    const key = model.replace(/\s+/g, ' ').trim().toLowerCase();
    const existingId = key ? existing.get(key) : undefined;

    const saved = inventoryRepo.upsert({
      id: existingId,
      type: type as any,
      manufacturer: manufacturer || undefined,
      model: model || undefined,
      description: cols.description !== undefined ? (cellText(at('description')!) || undefined) : undefined,
      quantity,
      unitPrice,
    });

    if (existingId) {
      result.updated++;
    } else {
      result.imported++;
      if (key) existing.set(key, saved.id);
    }
  }
  });

  runImport();
  return result;
}
