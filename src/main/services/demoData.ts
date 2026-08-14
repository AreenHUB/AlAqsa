// ============================================================================
// AlAqsa — Demo data seeding.
//
// Populates the app with realistic sample records so it is immediately usable
// and explorable, including the "لفة ورق عنب" restaurant chain taken from the
// original maintenance forms. All of it can be wiped with Factory Reset.
// ============================================================================

import { clientsRepo } from '../db/repositories/clientsRepo';
import { branchesRepo } from '../db/repositories/branchesRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { visitsRepo } from '../db/repositories/visitsRepo';
import { inventoryRepo, remindersRepo, statusLabelsRepo, camLicenseRepo, invoicesRepo } from '../db/repositories/miscRepo';
import { getDb } from '../db/database';

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

export function seedDemoData(): { clients: number } {
  const db = getDb();
  const existing = (db.prepare('SELECT count(*) AS c FROM clients').get() as { c: number }).c;
  if (existing > 0) return { clients: 0 }; // never duplicate

  const labels = statusLabelsRepo.list();
  const label = (arName: string) => labels.find((l) => l.name_ar === arName)?.id;

  let clientCount = 0;

  // -------------------------------------------------------------------------
  // 1) لفة ورق عنب — restaurant chain with multiple branches (from the forms)
  // -------------------------------------------------------------------------
  const laffa = clientsRepo.create({
    type: 'restaurant',
    nameAr: 'مطعم لفة ورق عنب',
    nameEn: 'Laffa Warak Enab Restaurant',
    statusLabelId: label('عمل جارٍ'),
    rating: 5,
    isFlagged: false,
    notes: 'سلسلة مطاعم — عقد صيانة دوري لجميع الفروع.',
  });
  clientCount++;

  clientsRepo.saveContacts(laffa.id, [
    {
      id: '', clientId: laffa.id, name: 'أبو محمد', role: 'المالك',
      phones: ['+971501234567'], emails: ['owner@laffa.ae'], isPrimary: true, order: 0,
    },
    {
      id: '', clientId: laffa.id, name: 'أحمد سمير', role: 'مدير العمليات',
      phones: ['+971559876543'], emails: ['ops@laffa.ae'], isPrimary: false, order: 1,
    },
  ]);

  const laffaBranches = [
    { nameAr: 'فرع الشارقة - النهدة', nameEn: 'Sharjah - Al Nahda', address: 'شارع النهدة، الشارقة', lat: 25.3009, lng: 55.3776 },
    { nameAr: 'فرع دبي - القصيص', nameEn: 'Dubai - Al Qusais', address: 'القصيص الصناعية، دبي', lat: 25.2769, lng: 55.3800 },
    { nameAr: 'فرع عجمان - الراشدية', nameEn: 'Ajman - Al Rashidiya', address: 'الراشدية، عجمان', lat: 25.4052, lng: 55.5136 },
  ];

  laffaBranches.forEach((b, bi) => {
    const branch = branchesRepo.create({
      clientId: laffa.id,
      nameAr: b.nameAr,
      nameEn: b.nameEn,
      location: { address: b.address, lat: b.lat, lng: b.lng },
      statusLabelId: label(bi === 2 ? 'يحتاج متابعة' : 'مكتمل'),
      managerContact: '+9715012345' + (60 + bi),
    });

    // NVR for the branch
    devicesRepo.create({
      branchId: branch.id, type: 'nvr', label: `NVR-${bi + 1}`,
      manufacturer: 'Hikvision', model: 'DS-7616NI-K2',
      serialNumber: `NVR${String(bi + 1).padStart(3, '0')}HK2024${bi}`,
      channels: 16, firmware: 'V4.30.085',
      source: 'ours', installDate: daysFromNow(-420 - bi * 30),
      warrantyExpiry: daysFromNow(bi === 2 ? 20 : 300 - bi * 40),
      health: bi === 2 ? 'warning' : 'excellent',
      positionInBranch: 'غرفة الإدارة',
    });

    // Hard disks
    devicesRepo.create({
      branchId: branch.id, type: 'hdd', label: `HDD-${bi + 1}A`,
      manufacturer: 'Seagate', model: 'SkyHawk ST4000VX016',
      serialNumber: `HDD${String(bi + 1).padStart(3, '0')}SG4TB${bi}`,
      capacity: '4TB', source: 'ours', installDate: daysFromNow(-420 - bi * 30),
      warrantyExpiry: daysFromNow(250 - bi * 40),
      health: bi === 2 ? 'warning' : 'good',
    });

    // Cameras — variable count per branch (proves the flexible design)
    const cameraCount = [6, 8, 4][bi];
    const spots = ['المدخل الرئيسي', 'الكاشير', 'صالة الطعام', 'المطبخ', 'المخزن', 'الموقف الخلفي', 'الممر', 'الواجهة'];
    for (let i = 0; i < cameraCount; i++) {
      devicesRepo.create({
        branchId: branch.id, type: 'camera', label: `CAM-${i + 1}`,
        positionInBranch: spots[i % spots.length],
        manufacturer: 'Hikvision',
        model: i % 2 === 0 ? 'DS-2CD2143G2-I' : 'DS-2CD1043G0-I',
        serialNumber: `CAM${bi}${String(i + 1).padStart(2, '0')}HK${2024 + i}`,
        source: 'ours', installDate: daysFromNow(-420 - bi * 30),
        warrantyExpiry: daysFromNow(200 - bi * 30 + i),
        health: bi === 2 && i === 1 ? 'faulty' : 'excellent',
        notes: bi === 2 && i === 1 ? 'الصورة مشوشة — تحتاج استبدال' : undefined,
      });
    }

    // PoE switch (one branch has an external device — not bought from us)
    devicesRepo.create({
      branchId: branch.id, type: 'poe_switch', label: `POE-${bi + 1}`,
      manufacturer: bi === 1 ? 'TP-Link' : 'Hikvision',
      model: bi === 1 ? 'TL-SG1008P' : 'DS-3E0109P-E',
      serialNumber: `POE${bi}TL${2024}`,
      source: bi === 1 ? 'external' : 'ours',
      installDate: daysFromNow(-400),
      health: 'good',
      notes: bi === 1 ? 'الجهاز من مورّد آخر — ليس من المحل' : undefined,
    });

    // A completed maintenance visit for each branch
    const cams = devicesRepo.listByBranch(branch.id).filter((d) => d.type === 'camera');
    visitsRepo.create({
      clientId: laffa.id, branchId: branch.id, type: 'maintenance',
      visitDate: daysFromNow(-30 - bi * 10),
      nextVisitDate: daysFromNow(60 - bi * 10),
      technician: bi === 0 ? 'م. خالد' : 'م. يوسف',
      checklist: {
        cleanCameras: true, cleanNvr: true, checkNetworkCables: true,
        checkPowerSupply: true, testRecordPlayback: true, setDateTime: true,
        updateFirmware: bi === 0, testRemoteView: true, checkStorageSpace: true,
      },
      cameraChecks: cams.map((c) => ({
        deviceId: c.id,
        status: c.health === 'faulty' ? 'needs_service' : 'ok',
        lensCleaned: true, imageChecked: true, networkChecked: true,
        notes: c.health === 'faulty' ? 'يحتاج استبدال' : undefined,
      })),
      replacedParts: bi === 2
        ? [{ id: 'rp1', description: 'كاميرا CAM-2', oldSerial: 'CAM202HK2025', newSerial: 'CAM202HK2026NEW', reason: 'صورة مشوشة' }]
        : [],
      faultsFound: bi === 2 ? 'كاميرا رقم 2 صورتها مشوشة، والقرص الصلب يعطي تحذير صحي.' : 'لا توجد أعطال.',
      actionsTaken: bi === 2 ? 'تم استبدال الكاميرا وتنظيف الجهاز وفحص الكابلات.' : 'تنظيف شامل وفحص كامل للنظام.',
      recommendations: bi === 2 ? 'يُنصح باستبدال القرص الصلب خلال شهر.' : 'الاستمرار بالصيانة الدورية كل 3 أشهر.',
    });

    // UAE camera license per branch
    camLicenseRepo.save({
      clientId: laffa.id, branchId: branch.id,
      licenseNumber: `CCTV-${2024 + bi}-${1000 + bi}`,
      issueDate: daysFromNow(-330 - bi * 10),
      renewalDate: daysFromNow(20 + bi * 40),
      expiryDate: daysFromNow(35 + bi * 40),
      notes: bi === 0 ? 'يجب التجديد قريباً' : undefined,
    });
  });

  // -------------------------------------------------------------------------
  // 2) A company client with a flagged (bad payer) record
  // -------------------------------------------------------------------------
  const company = clientsRepo.create({
    type: 'company',
    nameAr: 'شركة الخليج للتجارة',
    nameEn: 'Gulf Trading Co.',
    statusLabelId: label('عطل'),
    rating: 2,
    isFlagged: true,
    flagReason: 'تأخر متكرر في السداد — يُرجى أخذ الحيطة قبل أي تركيب جديد.',
    notes: 'العميل لديه دفعتان متأخرتان.',
  });
  clientCount++;
  clientsRepo.saveContacts(company.id, [{
    id: '', clientId: company.id, name: 'سالم العامري', role: 'المدير المالي',
    phones: ['+971502223344'], emails: ['finance@gulftrading.ae'], isPrimary: true, order: 0,
  }]);
  const compBranch = branchesRepo.create({
    clientId: company.id, nameAr: 'المقر الرئيسي', nameEn: 'Head Office',
    location: { address: 'منطقة الحمرية، الشارقة' }, statusLabelId: label('متوقف'),
  });
  for (let i = 0; i < 3; i++) {
    devicesRepo.create({
      branchId: compBranch.id, type: 'camera', label: `CAM-${i + 1}`,
      manufacturer: 'Dahua', model: 'IPC-HFW2431S-S',
      serialNumber: `GLF${String(i + 1).padStart(3, '0')}DH2024`,
      source: 'ours', installDate: daysFromNow(-180),
      warrantyExpiry: daysFromNow(185), health: 'good',
      positionInBranch: ['الاستقبال', 'المستودع', 'الموقف'][i],
    });
  }
  invoicesRepo.save({
    clientId: company.id, number: 'INV-2025-041', date: daysFromNow(-95),
    dueDate: daysFromNow(-65), total: 8500, paid: 3000, notes: 'دفعة أولى فقط',
  });

  // -------------------------------------------------------------------------
  // 3) A villa (individual person client)
  // -------------------------------------------------------------------------
  const villa = clientsRepo.create({
    type: 'villa', nameAr: 'فيلا السيد عبدالله', nameEn: 'Mr. Abdullah Villa',
    statusLabelId: label('مكتمل'), rating: 4,
    notes: 'تركيب جديد — العميل متعاون.',
  });
  clientCount++;
  clientsRepo.saveContacts(villa.id, [{
    id: '', clientId: villa.id, name: 'عبدالله المرزوقي', role: 'المالك',
    phones: ['+971507778899'], emails: ['abdullah@example.ae'], isPrimary: true, order: 0,
  }]);
  const villaBranch = branchesRepo.create({
    clientId: villa.id, nameAr: 'الفيلا', nameEn: 'Villa',
    location: { address: 'مويلح، الشارقة' }, statusLabelId: label('مكتمل'),
  });
  devicesRepo.create({
    branchId: villaBranch.id, type: 'dvr', label: 'DVR-1',
    manufacturer: 'Dahua', model: 'XVR5108HS-I3', serialNumber: 'DVR001DH2025',
    channels: 8, source: 'ours', installDate: daysFromNow(-45),
    warrantyExpiry: daysFromNow(685), health: 'excellent',
  });
  for (let i = 0; i < 4; i++) {
    devicesRepo.create({
      branchId: villaBranch.id, type: 'camera', label: `CAM-${i + 1}`,
      manufacturer: 'Dahua', model: 'HAC-HFW1200TL',
      serialNumber: `VIL${String(i + 1).padStart(3, '0')}DH2025`,
      source: 'ours', installDate: daysFromNow(-45),
      warrantyExpiry: daysFromNow(685), health: 'excellent',
      positionInBranch: ['البوابة', 'الحديقة', 'المدخل', 'الكراج'][i],
    });
  }
  visitsRepo.create({
    clientId: villa.id, branchId: villaBranch.id, type: 'installation',
    visitDate: daysFromNow(-45), nextVisitDate: daysFromNow(135),
    technician: 'م. خالد',
    checklist: {
      cleanCameras: true, cleanNvr: true, checkNetworkCables: true,
      checkPowerSupply: true, testRecordPlayback: true, setDateTime: true,
      updateFirmware: true, testRemoteView: true, checkStorageSpace: true,
    },
    cameraChecks: [], replacedParts: [],
    actionsTaken: 'تركيب نظام كامل 4 كاميرات مع جهاز DVR وتمديد الكابلات.',
    recommendations: 'صيانة دورية كل 6 أشهر.',
  });

  // -------------------------------------------------------------------------
  // 4) Shop inventory (feeds autocomplete when adding devices)
  // -------------------------------------------------------------------------
  const inv = [
    { type: 'camera', manufacturer: 'Hikvision', model: 'DS-2CD2143G2-I', description: 'كاميرا دوم 4MP', quantity: 25, unitPrice: 320 },
    { type: 'camera', manufacturer: 'Hikvision', model: 'DS-2CD1043G0-I', description: 'كاميرا بوليت 4MP', quantity: 18, unitPrice: 280 },
    { type: 'camera', manufacturer: 'Dahua', model: 'IPC-HFW2431S-S', description: 'كاميرا بوليت 4MP', quantity: 12, unitPrice: 295 },
    { type: 'camera', manufacturer: 'Dahua', model: 'HAC-HFW1200TL', description: 'كاميرا HDCVI 2MP', quantity: 30, unitPrice: 150 },
    { type: 'nvr', manufacturer: 'Hikvision', model: 'DS-7616NI-K2', description: 'مسجل شبكي 16 قناة', quantity: 6, unitPrice: 1100 },
    { type: 'nvr', manufacturer: 'Hikvision', model: 'DS-7608NI-K2', description: 'مسجل شبكي 8 قنوات', quantity: 8, unitPrice: 780 },
    { type: 'dvr', manufacturer: 'Dahua', model: 'XVR5108HS-I3', description: 'مسجل 8 قنوات', quantity: 5, unitPrice: 650 },
    { type: 'hdd', manufacturer: 'Seagate', model: 'ST4000VX016', description: 'قرص صلب SkyHawk 4TB', quantity: 15, unitPrice: 420 },
    { type: 'hdd', manufacturer: 'Western Digital', model: 'WD20PURZ', description: 'قرص صلب Purple 2TB', quantity: 20, unitPrice: 260 },
    { type: 'poe_switch', manufacturer: 'Hikvision', model: 'DS-3E0109P-E', description: 'سويتش PoE 8 منافذ', quantity: 10, unitPrice: 340 },
    { type: 'ups', manufacturer: 'APC', model: 'BX650LI-MS', description: 'UPS 650VA', quantity: 7, unitPrice: 250 },
    { type: 'router', manufacturer: 'TP-Link', model: 'Archer C6', description: 'راوتر لاسلكي', quantity: 9, unitPrice: 180 },
  ];
  inv.forEach((i) => inventoryRepo.upsert(i as any));

  // -------------------------------------------------------------------------
  // 5) Reminders
  // -------------------------------------------------------------------------
  const laffaBranchList = branchesRepo.listByClient(laffa.id);
  remindersRepo.save({
    kind: 'maintenance_due', clientId: laffa.id, branchId: laffaBranchList[0]?.id,
    title: 'صيانة دورية — لفة ورق عنب / فرع الشارقة',
    dueDate: daysFromNow(14), leadDays: 7,
  });
  remindersRepo.save({
    kind: 'license_expiry', clientId: laffa.id, branchId: laffaBranchList[0]?.id,
    title: 'تجديد رخصة الكاميرات — فرع الشارقة',
    dueDate: daysFromNow(35), leadDays: 30,
  });
  remindersRepo.save({
    kind: 'invoice_overdue', clientId: company.id,
    title: 'متابعة دفعة متأخرة — شركة الخليج للتجارة',
    dueDate: daysFromNow(3), leadDays: 3,
  });

  return { clients: clientCount };
}
