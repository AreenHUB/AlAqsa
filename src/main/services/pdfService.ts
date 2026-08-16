// ============================================================================
// AlAqsa — PDF reports (Arabic RTL).
//
// Reproduces the original maintenance form: branch header, cameras table, NVR
// block, hard-disk table, 9-point checklist, replaced parts, visit report and
// the approval/signature block.
//
// Arabic shaping: pdfmake renders the embedded Noto Naskh Arabic font; text is
// pre-shaped by `arabicText()` which reverses logical order for RTL runs so the
// output reads correctly without a full bidi engine.
// ============================================================================

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { reportsDir } from '../storage/paths';
import { visitsRepo } from '../db/repositories/visitsRepo';
import { clientsRepo } from '../db/repositories/clientsRepo';
import { branchesRepo } from '../db/repositories/branchesRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { camLicenseRepo } from '../db/repositories/miscRepo';
import { APP_NAME_AR, AUTHOR } from '@shared/constants';
import type { Visit, Device } from '@shared/types';

// pdfmake is CommonJS; require keeps the typings simple here.
function pdfMake(): any {
  const PdfPrinter = require('pdfmake');
  const fontDir = fontsDirectory();
  const fonts = {
    Arabic: {
      normal: path.join(fontDir, 'NotoNaskhArabic-Regular.ttf'),
      bold: path.join(fontDir, 'NotoNaskhArabic-Bold.ttf'),
      italics: path.join(fontDir, 'NotoNaskhArabic-Regular.ttf'),
      bolditalics: path.join(fontDir, 'NotoNaskhArabic-Bold.ttf'),
    },
  };
  return new PdfPrinter(fonts);
}

/**
 * Locate the bundled Arabic fonts. Packaged builds ship them under
 * resources/fonts; unpackaged runs read them from <repo>/assets/fonts.
 * __dirname is used as the anchor so the lookup does not depend on the
 * process working directory or on which script started Electron.
 */
function fontsDirectory(): string {
  // The main process is bundled, so __dirname is dist/main (not the original
  // source folder). Several roots are probed so the lookup holds for the
  // packaged app, the unpackaged build and a plain source run alike.
  const candidates = [
    path.join(process.resourcesPath ?? '', 'fonts'),        // packaged
    path.join(app.getAppPath(), 'assets', 'fonts'),         // asar / app root
    path.join(app.getAppPath(), '..', 'fonts'),             // resources sibling
    path.join(__dirname, '..', '..', 'assets', 'fonts'),    // dist/main -> repo
    path.join(__dirname, '..', '..', '..', 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),            // dev fallback
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'NotoNaskhArabic-Regular.ttf'))) return dir;
  }
  throw new Error('ARABIC_FONTS_NOT_FOUND');
}

const AR_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** U+00A0. pdfmake collapses plain spaces between Arabic words during layout. */
const NBSP = ' ';
const NEWLINE = '\n';

/**
 * Prepare a string for RTL rendering.
 *
 * Two separate problems have to be handled, and only one of them is ours:
 *
 *  1. SPACING — pdfmake collapses runs of plain spaces between Arabic words
 *     during layout, which glues them together. Joining with a non-breaking
 *     space keeps the gap.
 *
 *  2. WORD ORDER — pdfmake already lays Arabic runs out right-to-left, so the
 *     words must be left in their LOGICAL order. An earlier version reversed
 *     them here too, which cancelled out pdfmake's own handling and printed
 *     every heading backwards ("صيانة زيارة تقرير" for "تقرير زيارة صيانة").
 *     Do not reverse.
 *
 *  3. EMBEDDED LATIN — when a line is mixed, pdfmake flips the WHOLE run,
 *     including any Latin or numeric island inside it, so "Power Supply"
 *     printed as "ylppuS rewoP" and "2026-07-20" as "20-70-6202". Those
 *     islands are pre-reversed here so that pdfmake's flip restores them.
 *     Their internal characters are reversed, and multi-word islands also have
 *     their word order reversed, so both survive the flip intact.
 *
 * Strings with no Arabic are returned untouched, so a model number or a date
 * still wraps where it legitimately should.
 */

/** Latin letters, digits and the punctuation that binds them (dates, codes). */
const LATIN_ISLAND = /[A-Za-z0-9][A-Za-z0-9\-_/.:+&'()]*(?: [A-Za-z0-9][A-Za-z0-9\-_/.:+&'()]*)*/g;

/**
 * Brackets are mirrored by the RTL flip: an opening one arrives as a closing
 * one. Swapping them beforehand means they come out facing the right way.
 */
const MIRRORED: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
  '<': '>', '>': '<', '«': '»', '»': '«',
};
const MIRROR_RE = /[()[\]{}<>«»]/g;

/** Reverse a Latin run so pdfmake's RTL flip puts it back the right way round. */
function preReverseLatin(line: string): string {
  return line.replace(LATIN_ISLAND, (island) => {
    // A run of several Latin words needs its word order reversed as well as
    // each word's characters, otherwise the flip returns the words backwards.
    const words = island.split(' ');
    return words
      .map((w) => [...w].reverse().join(''))
      .reverse()
      .join(' ');
  });
}

export function ar(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  const s = String(text);
  if (!AR_RANGE.test(s)) return s;
  return s
    .split(NEWLINE)
    .map((line) => {
      const latinFixed = preReverseLatin(line.trim());
      const bracketsFixed = latinFixed.replace(MIRROR_RE, (c) => MIRRORED[c] ?? c);
      return bracketsFixed.split(/\s+/).filter(Boolean).join(NBSP);
    })
    .join(NEWLINE);
}

// The bundled Arabic font carries no dingbat glyphs (✔/✘ would render as empty
// boxes), so completion is shown with Arabic words instead.
const tick = (b: boolean) => (b ? ar('نعم') : '—');

function header(titleAr: string, subtitle?: string) {
  return [
    {
      // Explicit halves. Auto-width columns size to their text and end up
      // touching in the middle, which printed "الأقصىAlAqsa CCTV" as one word.
      columns: [
        { width: '50%', text: 'AlAqsa CCTV', style: 'brandEn', alignment: 'left' },
        { width: '50%', text: ar(APP_NAME_AR), style: 'brand', alignment: 'right' },
      ],
      columnGap: 12,
    },
    { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 2, lineColor: '#0B4F8A' }] },
    { text: ar(titleAr), style: 'title', alignment: 'right', margin: [0, 10, 0, 2] },
    subtitle ? { text: ar(subtitle), style: 'subtitle', alignment: 'right', margin: [0, 0, 0, 8] } : {},
  ];
}

function footer(currentPage: number, pageCount: number) {
  return {
    columns: [
      { width: 60, text: `${currentPage} / ${pageCount}`, alignment: 'left', fontSize: 8, color: '#6b7280' },
      { width: '*', text: ar(`${APP_NAME_AR} — هاتف: ${AUTHOR.phone}`), alignment: 'right', fontSize: 8, color: '#6b7280' },
    ],
    margin: [40, 10, 40, 0],
  };
}

function labelValueTable(rows: [string, string][]) {
  return {
    table: {
      widths: ['*', 120],
      body: rows.map(([label, value]) => [
        { text: ar(value || '—'), alignment: 'right' },
        { text: ar(label), alignment: 'right', bold: true, fillColor: '#E3F2FD' },
      ]),
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 10],
  };
}

const DEVICE_TYPE_AR: Record<string, string> = {
  camera: 'كاميرا', nvr: 'NVR', dvr: 'DVR', hdd: 'قرص صلب',
  switch: 'سويتش', poe_switch: 'سويتش PoE', router: 'راوتر', ups: 'UPS', other: 'أخرى',
};

const VISIT_TYPE_AR: Record<string, string> = {
  maintenance: 'صيانة', installation: 'تركيب', supply: 'تزويد معدات',
  repair: 'إصلاح', inspection: 'معاينة',
};

const HEALTH_AR: Record<string, string> = {
  excellent: 'ممتاز', good: 'جيد', warning: 'تحذير', faulty: 'عطل',
};

/** Build the visit report document definition. */
function buildVisitDoc(visit: Visit, devices: Device[]) {
  const client = clientsRepo.get(visit.clientId);
  const branch = branchesRepo.get(visit.branchId);
  const cameras = devices.filter((d) => d.type === 'camera');
  const recorders = devices.filter((d) => d.type === 'nvr' || d.type === 'dvr');
  const disks = devices.filter((d) => d.type === 'hdd');
  const others = devices.filter((d) => !['camera', 'nvr', 'dvr', 'hdd'].includes(d.type));
  const checkOf = (id: string) => visit.cameraChecks.find((c) => c.deviceId === id);

  const content: any[] = [
    ...header('تقرير زيارة صيانة', `${client?.nameAr ?? ''} — ${branch?.nameAr ?? ''}`),

    labelValueTable([
      ['اسم العميل', client?.nameAr ?? ''],
      ['رمز العميل', client?.code ?? ''],
      ['اسم الفرع', branch?.nameAr ?? ''],
      ['الموقع', branch?.location.address ?? ''],
      ['نوع الزيارة', VISIT_TYPE_AR[visit.type] ?? visit.type],
      ['تاريخ الصيانة', visit.visitDate],
      ['الفني المسؤول', visit.technician ?? ''],
      ['الزيارة القادمة', visit.nextVisitDate ?? ''],
    ]),
  ];

  // ---- Cameras ------------------------------------------------------------
  if (cameras.length) {
    content.push({ text: ar('أولاً: الكاميرات'), style: 'section', alignment: 'right' });
    content.push({
      table: {
        headerRows: 1,
        // The serial and model carry long unbroken Latin codes, so they get
        // fixed generous widths and the notes column absorbs what is left.
        widths: ['*', 32, 32, 32, 42, 78, 78, 52, 20],
        body: [
          ['ملاحظات', 'الشبكة', 'الصورة', 'العدسة', 'الحالة', 'الرقم التسلسلي', 'الموديل', 'الموقع', 'م']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...cameras.map((c, i) => {
            const chk = checkOf(c.id);
            return [
              { text: ar(chk?.notes ?? c.notes ?? ''), alignment: 'right', fontSize: 8 },
              { text: tick(!!chk?.networkChecked), alignment: 'center' },
              { text: tick(!!chk?.imageChecked), alignment: 'center' },
              { text: tick(!!chk?.lensCleaned), alignment: 'center' },
              {
                text: ar(chk?.status === 'needs_service' ? 'يحتاج صيانة' : 'سليم'),
                alignment: 'center', fontSize: 8,
                color: chk?.status === 'needs_service' ? '#b91c1c' : '#15803d',
              },
              // Serials and model codes are Latin: keep them left-to-right and
              // let pdfmake break long ones rather than overflow the cell.
              { text: c.serialNumber ?? '—', alignment: 'left', fontSize: 7.5, noWrap: false },
              { text: c.model ?? '—', alignment: 'left', fontSize: 7.5, noWrap: false },
              { text: ar(c.positionInBranch ?? c.label ?? ''), alignment: 'right', fontSize: 8 },
              { text: String(i + 1), alignment: 'center', fontSize: 8 },
            ];
          }),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    });
  }

  // ---- Recorders ----------------------------------------------------------
  for (const r of recorders) {
    content.push({ text: ar(`ثانياً: جهاز التسجيل (${r.type.toUpperCase()})`), style: 'section', alignment: 'right' });
    content.push(labelValueTable([
      ['الشركة المصنعة', r.manufacturer ?? ''],
      ['الموديل', r.model ?? ''],
      ['الرقم التسلسلي (S/N)', r.serialNumber ?? ''],
      ['عدد القنوات', r.channels ? String(r.channels) : ''],
      ['إصدار البرنامج (Firmware)', r.firmware ?? ''],
      ['حالة الجهاز', HEALTH_AR[r.health ?? ''] ?? ''],
      ['ملاحظات', r.notes ?? ''],
    ]));
  }

  // ---- Hard disks ---------------------------------------------------------
  if (disks.length) {
    content.push({ text: ar('ثالثاً: الأقراص الصلبة'), style: 'section', alignment: 'right' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 70, '*', 60, '*', 28],
        body: [
          ['ملاحظات', 'الحالة الصحية', 'الرقم التسلسلي', 'السعة', 'الشركة', 'م']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...disks.map((d, i) => [
            { text: ar(d.notes ?? ''), alignment: 'right', fontSize: 8 },
            { text: ar(HEALTH_AR[d.health ?? ''] ?? '—'), alignment: 'center', fontSize: 8 },
            { text: d.serialNumber ?? '—', alignment: 'right', fontSize: 8 },
            { text: d.capacity ?? '—', alignment: 'center', fontSize: 8 },
            { text: d.manufacturer ?? '—', alignment: 'right', fontSize: 8 },
            { text: String(i + 1), alignment: 'center', fontSize: 8 },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    });
  }

  // ---- Other equipment ----------------------------------------------------
  if (others.length) {
    content.push({ text: ar('معدات أخرى'), style: 'section', alignment: 'right' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', '*', 70, 28],
        body: [
          ['الرقم التسلسلي', 'الموديل', 'الشركة', 'النوع', 'م']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...others.map((d, i) => [
            { text: d.serialNumber ?? '—', alignment: 'right', fontSize: 8 },
            { text: d.model ?? '—', alignment: 'right', fontSize: 8 },
            { text: d.manufacturer ?? '—', alignment: 'right', fontSize: 8 },
            { text: ar(DEVICE_TYPE_AR[d.type] ?? d.type), alignment: 'right', fontSize: 8 },
            { text: String(i + 1), alignment: 'center', fontSize: 8 },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    });
  }

  // ---- 9-point checklist --------------------------------------------------
  const cl = visit.checklist;
  const checklistRows: [string, boolean][] = [
    ['تنظيف جميع الكاميرات', cl.cleanCameras],
    ['تنظيف جهاز NVR', cl.cleanNvr],
    ['فحص كابلات الشبكة', cl.checkNetworkCables],
    ['فحص مصدر التغذية (Power Supply / PoE)', cl.checkPowerSupply],
    ['اختبار التسجيل والاسترجاع', cl.testRecordPlayback],
    ['ضبط الوقت والتاريخ', cl.setDateTime],
    ['تحديث Firmware (عند الحاجة)', cl.updateFirmware],
    ['اختبار المشاهدة عن بُعد', cl.testRemoteView],
    ['فحص مساحة التخزين', cl.checkStorageSpace],
  ];
  content.push({ text: ar('أعمال الصيانة المنفذة'), style: 'section', alignment: 'right' });
  content.push({
    table: {
      headerRows: 1,
      widths: [70, '*'],
      body: [
        [{ text: ar('تم التنفيذ'), style: 'th', alignment: 'center' }, { text: ar('البند'), style: 'th', alignment: 'right' }],
        ...checklistRows.map(([label, done]) => [
          { text: tick(done), alignment: 'center', color: done ? '#15803d' : '#b91c1c' },
          { text: ar(label), alignment: 'right', fontSize: 9 },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 12],
  });

  // ---- Replaced parts -----------------------------------------------------
  if (visit.replacedParts.length) {
    content.push({ text: ar('القطع المستبدلة'), style: 'section', alignment: 'right' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', '*', '*'],
        body: [
          ['السبب', 'الرقم التسلسلي الجديد', 'الرقم التسلسلي القديم', 'القطعة']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...visit.replacedParts.map((p) => [
            { text: ar(p.reason ?? ''), alignment: 'right', fontSize: 8 },
            { text: p.newSerial ?? '—', alignment: 'right', fontSize: 8 },
            { text: p.oldSerial ?? '—', alignment: 'right', fontSize: 8 },
            { text: ar(p.description), alignment: 'right', fontSize: 8 },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    });
  }

  // ---- Narrative ----------------------------------------------------------
  content.push({ text: ar('تقرير الزيارة'), style: 'section', alignment: 'right' });
  content.push(labelValueTable([
    ['الأعطال التي تم اكتشافها', visit.faultsFound ?? ''],
    ['الإجراءات التي تم تنفيذها', visit.actionsTaken ?? ''],
    ['التوصيات', visit.recommendations ?? ''],
  ]));

  // ---- Approval / signatures ---------------------------------------------
  content.push({ text: ar('اعتماد الزيارة'), style: 'section', alignment: 'right', margin: [0, 8, 0, 4] });
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: ar('مسؤول الفرع'), alignment: 'center', bold: true, fontSize: 9 },
          visit.signatureClient
            ? { text: ar('(موقَّع إلكترونياً)'), alignment: 'center', fontSize: 8, color: '#15803d', margin: [0, 14, 0, 0] }
            : { text: '________________________', alignment: 'center', margin: [0, 14, 0, 0] },
        ],
      },
      {
        width: '*',
        stack: [
          { text: ar('الفني'), alignment: 'center', bold: true, fontSize: 9 },
          visit.signatureTechnician
            ? { text: ar('(موقَّع إلكترونياً)'), alignment: 'center', fontSize: 8, color: '#15803d', margin: [0, 14, 0, 0] }
            : { text: '________________________', alignment: 'center', margin: [0, 14, 0, 0] },
        ],
      },
    ],
    margin: [0, 6, 0, 0],
  });
  content.push({
    text: ar(`التاريخ: ${visit.visitDate}`),
    alignment: 'right', fontSize: 9, margin: [0, 12, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Arabic', fontSize: 10 },
    content,
    footer,
    styles: {
      brand: { fontSize: 18, bold: true, color: '#0B4F8A' },
      brandEn: { fontSize: 12, bold: true, color: '#1E88E5' },
      title: { fontSize: 15, bold: true, color: '#0B4F8A' },
      subtitle: { fontSize: 11, color: '#374151' },
      section: { fontSize: 12, bold: true, color: '#0B4F8A', margin: [0, 10, 0, 4] },
      th: { bold: true, fontSize: 9, fillColor: '#E3F2FD', color: '#0B4F8A' },
    },
  };
}

function writePdf(docDefinition: any, outPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const printer = pdfMake();
      const doc = printer.createPdfKitDocument(docDefinition);
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);
      doc.end();
      stream.on('finish', () => resolve(outPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateVisitPdf(visitId: string, _dek: Buffer): Promise<string> {
  const visit = visitsRepo.get(visitId);
  if (!visit) throw new Error('VISIT_NOT_FOUND');
  const devices = devicesRepo.listByBranch(visit.branchId);
  const client = clientsRepo.get(visit.clientId);
  const safeName = (client?.nameAr ?? 'client').replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(reportsDir(), `تقرير-زيارة-${safeName}-${visit.visitDate}.pdf`);
  return writePdf(buildVisitDoc(visit, devices), out);
}

/**
 * Printable invoice / service contract: line items, VAT with the shop's TRN,
 * payment status and a signature block so the same document can be handed over
 * as a contract.
 */
export async function generateInvoicePdf(invoiceId: string): Promise<string> {
  const { invoicesRepo, settingsRepo } = require('../db/repositories/miscRepo') as typeof import('../db/repositories/miscRepo');
  const invoice = invoicesRepo.get(invoiceId);
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  const client = clientsRepo.get(invoice.clientId);
  const contacts = clientsRepo.contacts(invoice.clientId);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

  const shopName = settingsRepo.get('shop.name') ?? APP_NAME_AR;
  const shopTrn = settingsRepo.get('shop.trn') ?? '';
  const shopAddress = settingsRepo.get('shop.address') ?? '';
  const shopPhone = settingsRepo.get('shop.phone') ?? AUTHOR.phone;

  const money = (n: number) => n.toFixed(2);
  const balance = invoice.total - invoice.paid;

  const content: any[] = [
    ...header('فاتورة / عقد صيانة', `${invoice.number} — ${invoice.date}`),

    {
      columns: [
        {
          width: '*',
          stack: [
            { text: ar('إلى (العميل)'), bold: true, alignment: 'right', color: '#0B4F8A' },
            { text: ar(client?.nameAr ?? ''), alignment: 'right' },
            { text: ar(primary?.name ?? ''), alignment: 'right', fontSize: 9 },
            { text: primary?.phones?.[0] ?? '', alignment: 'right', fontSize: 9 },
          ],
        },
        {
          width: '*',
          stack: [
            { text: ar('من (المورّد)'), bold: true, alignment: 'right', color: '#0B4F8A' },
            { text: ar(shopName), alignment: 'right' },
            shopAddress ? { text: ar(shopAddress), alignment: 'right', fontSize: 9 } : {},
            { text: shopPhone, alignment: 'right', fontSize: 9 },
            shopTrn ? { text: ar(`الرقم الضريبي: ${shopTrn}`), alignment: 'right', fontSize: 9 } : {},
          ],
        },
      ],
      columnGap: 16,
      margin: [0, 4, 0, 12],
    },

    labelValueTable([
      ['رقم الفاتورة', invoice.number],
      ['التاريخ', invoice.date],
      ['تاريخ الاستحقاق', invoice.dueDate ?? '—'],
      ...(invoice.trn ? [['الرقم الضريبي للعميل', invoice.trn] as [string, string]] : []),
    ]),
  ];

  // ---- Line items ---------------------------------------------------------
  const itemRows = invoice.items.length
    ? invoice.items
    : [{ id: 'x', description: 'خدمات صيانة', quantity: 1, unitPrice: invoice.subtotal || invoice.total }];

  content.push({ text: ar('تفاصيل الفاتورة'), style: 'section', alignment: 'right' });
  content.push({
    table: {
      headerRows: 1,
      widths: [70, 70, 45, '*', 26],
      body: [
        ['الإجمالي', 'سعر الوحدة', 'الكمية', 'البيان', 'م']
          .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
        ...itemRows.map((it, i) => [
          { text: money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), alignment: 'right', fontSize: 9 },
          { text: money(Number(it.unitPrice) || 0), alignment: 'right', fontSize: 9 },
          { text: String(it.quantity ?? 1), alignment: 'center', fontSize: 9 },
          { text: ar(it.description), alignment: 'right', fontSize: 9 },
          { text: String(i + 1), alignment: 'center', fontSize: 9 },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 10],
  });

  // ---- Totals -------------------------------------------------------------
  const totalsBody: any[] = [
    [{ text: money(invoice.subtotal), alignment: 'right' }, { text: ar('المجموع قبل الضريبة'), alignment: 'right' }],
  ];
  if (invoice.taxRate > 0) {
    totalsBody.push([
      { text: money(invoice.taxAmount), alignment: 'right' },
      { text: ar(`ضريبة القيمة المضافة (${invoice.taxRate}%)`), alignment: 'right' },
    ]);
  }
  totalsBody.push([
    { text: money(invoice.total), alignment: 'right', bold: true, fillColor: '#E3F2FD' },
    { text: ar('الإجمالي المستحق'), alignment: 'right', bold: true, fillColor: '#E3F2FD' },
  ]);
  totalsBody.push([{ text: money(invoice.paid), alignment: 'right' }, { text: ar('المدفوع'), alignment: 'right' }]);
  totalsBody.push([
    { text: money(balance), alignment: 'right', bold: true, color: balance > 0 ? '#b91c1c' : '#15803d' },
    { text: ar('المتبقي'), alignment: 'right', bold: true },
  ]);

  content.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 260,
        table: { widths: [90, '*'], body: totalsBody },
        layout: 'lightHorizontalLines',
      },
    ],
    margin: [0, 0, 0, 12],
  });

  if (invoice.terms) {
    content.push({ text: ar('الشروط'), style: 'section', alignment: 'right' });
    content.push({ text: ar(invoice.terms), alignment: 'right', fontSize: 9, margin: [0, 0, 0, 10] });
  }
  if (invoice.notes) {
    content.push({ text: ar(`ملاحظات: ${invoice.notes}`), alignment: 'right', fontSize: 9, margin: [0, 0, 0, 10] });
  }

  content.push({
    columns: [
      { width: '*', stack: [{ text: ar('توقيع العميل'), alignment: 'center', bold: true, fontSize: 9 }, { text: '________________________', alignment: 'center', margin: [0, 18, 0, 0] }] },
      { width: '*', stack: [{ text: ar('عن المورّد'), alignment: 'center', bold: true, fontSize: 9 }, { text: '________________________', alignment: 'center', margin: [0, 18, 0, 0] }] },
    ],
    margin: [0, 14, 0, 0],
  });

  const safe = (client?.nameAr ?? 'client').replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(reportsDir(), `فاتورة-${invoice.number}-${safe}.pdf`);
  return writePdf({
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Arabic', fontSize: 10 },
    content,
    footer,
    styles: {
      brand: { fontSize: 18, bold: true, color: '#0B4F8A' },
      brandEn: { fontSize: 12, bold: true, color: '#1E88E5' },
      title: { fontSize: 15, bold: true, color: '#0B4F8A' },
      subtitle: { fontSize: 11, color: '#374151' },
      section: { fontSize: 12, bold: true, color: '#0B4F8A', margin: [0, 10, 0, 4] },
      th: { bold: true, fontSize: 9, fillColor: '#E3F2FD', color: '#0B4F8A' },
    },
  }, out);
}

/** Service agreement / equipment handover document for a client. */
export async function generateAgreementPdf(clientId: string): Promise<string> {
  const client = clientsRepo.get(clientId);
  if (!client) throw new Error('CLIENT_NOT_FOUND');
  const branches = branchesRepo.listByClient(clientId);
  const contacts = clientsRepo.contacts(clientId);
  const licenses = camLicenseRepo.listByClient(clientId);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

  const content: any[] = [
    ...header('اتفاقية صيانة أنظمة المراقبة', client.nameAr),
    labelValueTable([
      ['اسم العميل', client.nameAr],
      ['رمز العميل', client.code],
      ['جهة الاتصال', primary?.name ?? ''],
      ['الهاتف', primary?.phones?.[0] ?? ''],
      ['البريد الإلكتروني', primary?.emails?.[0] ?? ''],
      ['عدد الفروع', String(branches.length)],
      ['تاريخ الإصدار', new Date().toISOString().slice(0, 10)],
    ]),
  ];

  // Branch + equipment summary
  content.push({ text: ar('الفروع والمعدات المشمولة'), style: 'section', alignment: 'right' });
  for (const b of branches) {
    const devs = devicesRepo.listByBranch(b.id);
    const cams = devs.filter((d) => d.type === 'camera').length;
    content.push({ text: ar(`• ${b.nameAr} — ${b.location.address ?? ''}`), alignment: 'right', bold: true, margin: [0, 6, 0, 2] });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', '*', 70, 28],
        body: [
          ['الرقم التسلسلي', 'الموديل', 'الشركة', 'النوع', 'م']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...devs.map((d, i) => [
            { text: d.serialNumber ?? '—', alignment: 'right', fontSize: 8 },
            { text: d.model ?? '—', alignment: 'right', fontSize: 8 },
            { text: d.manufacturer ?? '—', alignment: 'right', fontSize: 8 },
            { text: ar(DEVICE_TYPE_AR[d.type] ?? d.type), alignment: 'right', fontSize: 8 },
            { text: String(i + 1), alignment: 'center', fontSize: 8 },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 2, 0, 8],
    });
    content.push({ text: ar(`إجمالي الكاميرات في هذا الفرع: ${cams}`), alignment: 'right', fontSize: 9, margin: [0, 0, 0, 8] });
  }

  if (licenses.length) {
    content.push({ text: ar('رخص الكاميرات'), style: 'section', alignment: 'right' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', '*'],
        body: [
          ['تاريخ الانتهاء', 'تاريخ التجديد', 'رقم الرخصة']
            .map((h) => ({ text: ar(h), style: 'th', alignment: 'right' })),
          ...licenses.map((l) => [
            { text: l.expiryDate ?? '—', alignment: 'right', fontSize: 8 },
            { text: l.renewalDate ?? '—', alignment: 'right', fontSize: 8 },
            { text: l.licenseNumber ?? '—', alignment: 'right', fontSize: 8 },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    });
  }

  content.push({ text: ar('الشروط'), style: 'section', alignment: 'right' });
  content.push({
    ul: [
      ar('تشمل الاتفاقية الصيانة الدورية وفحص الأجهزة المذكورة أعلاه.'),
      ar('لا تشمل الاتفاقية الأضرار الناتجة عن سوء الاستخدام أو الكوارث الطبيعية.'),
      ar('يلتزم العميل بتوفير الوصول للموقع في مواعيد الصيانة المتفق عليها.'),
      ar('قطع الغيار تُحتسب بشكل منفصل ما لم يُذكر خلاف ذلك.'),
    ],
    alignment: 'right',
    margin: [0, 4, 0, 12],
  });

  content.push({
    columns: [
      { width: '*', stack: [{ text: ar('توقيع العميل'), alignment: 'center', bold: true, fontSize: 9 }, { text: '________________________', alignment: 'center', margin: [0, 16, 0, 0] }] },
      { width: '*', stack: [{ text: ar('عن الشركة'), alignment: 'center', bold: true, fontSize: 9 }, { text: '________________________', alignment: 'center', margin: [0, 16, 0, 0] }] },
    ],
    margin: [0, 10, 0, 0],
  });

  const safeName = client.nameAr.replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(reportsDir(), `اتفاقية-${safeName}-${Date.now()}.pdf`);
  return writePdf({
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Arabic', fontSize: 10 },
    content,
    footer,
    styles: {
      brand: { fontSize: 18, bold: true, color: '#0B4F8A' },
      brandEn: { fontSize: 12, bold: true, color: '#1E88E5' },
      title: { fontSize: 15, bold: true, color: '#0B4F8A' },
      subtitle: { fontSize: 11, color: '#374151' },
      section: { fontSize: 12, bold: true, color: '#0B4F8A', margin: [0, 10, 0, 4] },
      th: { bold: true, fontSize: 9, fillColor: '#E3F2FD', color: '#0B4F8A' },
    },
  }, out);
}
