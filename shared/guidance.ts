import { z } from 'zod';
import type { SpineRouteId } from './spine.js';
import { DisplayTimeZoneSchema, UtcInstantSchema } from './temporal.js';

/**
 * M2 End-User Guidance, Localization & Currency Display Contracts
 * (MASTER_PROMPT §11.16 DOC1, §12.1 TMP3, §12.2 LOC1–LOC4).
 *
 * - All UI guidance text is keyed in `I18N_MESSAGES` with 100% locale parity across `en-US`, `ar-SA`, and `pseudo`.
 * - Currency formatting uses exact canonical string + BigInt integer grouping (zero JS float math on money).
 * - Display timezone conversion formats UTC instants without altering underlying ledger dates or figures.
 */

export const SupportedLocaleSchema = z.enum(['en-US', 'ar-SA', 'pseudo']);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;

export const SUPPORTED_DISPLAY_TIMEZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo',
] as const;

export function isRtlLocale(locale: SupportedLocale): boolean {
  return locale === 'ar-SA';
}

export const SPINE_HELP_KEYS: Readonly<Record<SpineRouteId, `help.screen.${SpineRouteId}`>> = {
  sign_in: 'help.screen.sign_in',
  setup: 'help.screen.setup',
  import: 'help.screen.import',
  coa_mapper: 'help.screen.coa_mapper',
  model_grid: 'help.screen.model_grid',
  statements: 'help.screen.statements',
  board_pack: 'help.screen.board_pack',
};

const EN_US_MESSAGES = {
  'help.drawer.openButton': 'Help & Guide',
  'help.drawer.closeButton': 'Close guide',
  'help.drawer.title': 'Workspace Guide & Onboarding',
  'help.drawer.localeLabel': 'Display locale',
  'help.drawer.timezoneLabel': 'Display timezone',
  'help.drawer.screenHelpHeading': 'Current screen guidance',
  'help.drawer.whatToCheckLabel': 'What to check',
  'help.drawer.nextStepLabel': 'Next step',
  'help.drawer.checklistHeading': 'First-Company Onboarding Checklist',
  'help.drawer.progressLabel': 'Steps verified',
  'help.drawer.reloadChecklist': 'Reload checklist',
  'help.drawer.completeButton': 'Complete Onboarding',
  'help.drawer.completedBadge': 'Onboarding verified and signed off',
  'help.drawer.noCompanyHint': 'Sign in and complete Company Setup to verify workspace onboarding steps.',
  'help.drawer.anchorClockLabel': 'Reference UTC audit instant',
  'help.screen.sign_in.title': 'Sign In & Session Boundary',
  'help.screen.sign_in.summary': 'Authenticate with Firebase or sandbox credentials to establish a company-scoped workspace session.',
  'help.screen.sign_in.whatToCheck': 'Verify your session status shows authenticated before creating or opening a company.',
  'help.screen.sign_in.nextStep': 'Continue to Company Setup to define fiscal calendar and base currency.',
  'help.screen.setup.title': 'Company Setup & Fiscal Calendar',
  'help.screen.setup.summary': 'Create your company ledger with an explicit base ISO-4217 currency and fiscal calendar structure.',
  'help.screen.setup.whatToCheck': 'Confirm calendar kind (12-month or NRF 4-4-5/4-5-4/5-4-4/13x4) and fiscal year boundaries match your GL.',
  'help.screen.setup.nextStep': 'Open Chart Mapper to establish postable accounts or apply a verified data-only industry pack.',
  'help.screen.import.title': 'Import Wizard, Connectors & Cutover',
  'help.screen.import.summary': 'Preview and commit balanced actuals CSVs, budget CSVs, connector sync runs, or onboarding migration rehearsals.',
  'help.screen.import.whatToCheck': 'Ensure rowsIn equals importedCount plus quarantinedCount and review any quarantined rows before closing.',
  'help.screen.import.nextStep': 'Resolve any unmapped source codes in Chart Mapper, then inspect Trial Balance in Model Grid.',
  'help.screen.coa_mapper.title': 'Chart of Accounts & Versioned Mapping',
  'help.screen.coa_mapper.summary': 'Manage active postable accounts, apply data-only industry packs, and publish effective-dated source mappings.',
  'help.screen.coa_mapper.whatToCheck': 'Confirm every active source code maps to an active postable account or carries an explicit quarantine reason.',
  'help.screen.coa_mapper.nextStep': 'Return to Import Wizard to re-commit actuals or proceed to Model Grid & Planning.',
  'help.screen.model_grid.title': 'Model Grid, Trial Balance & Planning',
  'help.screen.model_grid.summary': 'Review active Trial Balance postings with row drilldown and author driver, rolling forecast, and workforce plans.',
  'help.screen.model_grid.whatToCheck': 'Verify Trial Balance debits equal credits and check rolling forecast actual vs forecast period cutoffs.',
  'help.screen.model_grid.nextStep': 'Open Financial Statements to inspect P&L, Balance Sheet, Cash Flow, BvA, Flux/PVM, and Dashboards.',
  'help.screen.statements.title': 'Statements, BvA, Flux/PVM & Dashboards',
  'help.screen.statements.summary': 'Inspect server-computed P&L, Balance Sheet, Indirect Cash Flow, Budget-vs-Actual, Flux/PVM bridges, and KPI dashboards.',
  'help.screen.statements.whatToCheck': 'Verify articulation checks A1-A5 pass and review unplanned actual accounts separately from planned rows.',
  'help.screen.statements.nextStep': 'Open Board Pack to preview and export audit-tied XLSX, PDF, or PPTX deliverables.',
  'help.screen.board_pack.title': 'Board Pack Preview & Multi-Format Export',
  'help.screen.board_pack.summary': 'Generate audit-tied XLSX, PDF, and PPTX board packs from one canonical server row set.',
  'help.screen.board_pack.whatToCheck': 'Confirm all articulation checks and source batch hashes match before downloading executive artifacts.',
  'help.screen.board_pack.nextStep': 'Archive exported artifacts or finish the onboarding checklist sign-off in this guide.',
  'checklist.step.company_setup.title': 'Company & Fiscal Calendar',
  'checklist.step.company_setup.description': 'Create the company ledger and persisted fiscal periods.',
  'checklist.step.chart_of_accounts.title': 'Active Chart of Accounts',
  'checklist.step.chart_of_accounts.description': 'Publish at least one active postable account (CSV import or industry pack).',
  'checklist.step.actuals_import.title': 'Balanced Actuals Baseline',
  'checklist.step.actuals_import.description': 'Stage or commit a valid actuals import batch for the company.',
  'checklist.step.plan_baseline.title': 'Versioned Plan Baseline',
  'checklist.step.plan_baseline.description': 'Commit a budget, driver plan, or workforce plan version.',
  'checklist.step.owner_signoff.title': 'Owner Readiness Sign-Off',
  'checklist.step.owner_signoff.description': 'Record an audited workspace owner or editor onboarding sign-off.',
} as const;

export type I18nMessageKey = keyof typeof EN_US_MESSAGES;
export const I18N_MESSAGE_KEYS: readonly I18nMessageKey[] = Object.keys(EN_US_MESSAGES) as I18nMessageKey[];

const AR_SA_MESSAGES: Readonly<Record<I18nMessageKey, string>> = {
  'help.drawer.openButton': 'المساعدة والدليل',
  'help.drawer.closeButton': 'إغلاق الدليل',
  'help.drawer.title': 'دليل مساحة العمل والإعداد الأولي',
  'help.drawer.localeLabel': 'لغة العرض',
  'help.drawer.timezoneLabel': 'المنطقة الزمنية للعرض',
  'help.drawer.screenHelpHeading': 'إرشادات الشاشة الحالية',
  'help.drawer.whatToCheckLabel': 'ما يجب التحقق منه',
  'help.drawer.nextStepLabel': 'الخطوة التالية',
  'help.drawer.checklistHeading': 'قائمة التحقق لإعداد الشركة الأولى',
  'help.drawer.progressLabel': 'الخطوات المكتملة',
  'help.drawer.reloadChecklist': 'إعادة تحميل القائمة',
  'help.drawer.completeButton': 'اعتماد اكتمال الإعداد',
  'help.drawer.completedBadge': 'تم التحقق من الإعداد واعتماده رسمياً',
  'help.drawer.noCompanyHint': 'سجل الدخول وأنشئ الشركة لعرض خطوات الإعداد والتحقق منها.',
  'help.drawer.anchorClockLabel': 'الطابع الزمني المرجعي للتدقيق',
  'help.screen.sign_in.title': 'تسجيل الدخول وحدود الجلسة',
  'help.screen.sign_in.summary': 'سجّل الدخول لبدء جلسة عمل مالية معزولة لكل شركة.',
  'help.screen.sign_in.whatToCheck': 'تأكد من حالة المصادقة قبل إنشاء الشركة أو فتح دفتر الأستاذ.',
  'help.screen.sign_in.nextStep': 'انتقل إلى إعداد الشركة لتحديد السنة المالية والعملة الأساسية.',
  'help.screen.setup.title': 'إعداد الشركة والتقويم المالي',
  'help.screen.setup.summary': 'أنشئ الشركة وحدد عملة ISO-4217 الأساسية وهيكل الفترات المالية.',
  'help.screen.setup.whatToCheck': 'تحقق من تطابق نوع التقويم المالي وبداية السنة مع نظام القيود.',
  'help.screen.setup.nextStep': 'افتح مخطط الحسابات لاستيراد الدليل أو تطبيق حزمة القطاع القياسية.',
  'help.screen.import.title': 'معالج الاستيراد والموصلات والترحيل',
  'help.screen.import.summary': 'عاين واعتمد قيود الفعل والميزانية ومزامنة الموصلات وتجارب الترحيل.',
  'help.screen.import.whatToCheck': 'تحقق من تساوي إجمالي الصفوف مع الصفوف المرحلة والمحجوزة قبل الإغلاق.',
  'help.screen.import.nextStep': 'اربط الرموز غير المطابقة في مخطط الحسابات ثم راجع ميزان المراجعة.',
  'help.screen.coa_mapper.title': 'دليل الحسابات والربط المؤرخ بالإصدارات',
  'help.screen.coa_mapper.summary': 'أدر الحسابات النشطة القابلة للترحيل وطبّق الحزم القياسية واعتمد الربط.',
  'help.screen.coa_mapper.whatToCheck': 'تأكد من ربط كل رمز مصدر نشط بحساب قابل للترحيل أو تبرير حجبه.',
  'help.screen.coa_mapper.nextStep': 'ارجع إلى معالج الاستيراد أو انتقل إلى شبكة النمذجة والتخطيط.',
  'help.screen.model_grid.title': 'شبكة النمذجة وميزان المراجعة والتخطيط',
  'help.screen.model_grid.summary': 'راجع أرصدة ميزان المراجعة والتتبع للمصدر وخطط المحركات والقوى العاملة.',
  'help.screen.model_grid.whatToCheck': 'تأكد من توازن المدين والدائن ومراجعة نقطة الفصل بين الفعلي والمتوقع.',
  'help.screen.model_grid.nextStep': 'انتقل إلى القوائم المالية لمراجعة الدخل والمركز المالي والتدفقات ولوحة المؤشرات.',
  'help.screen.statements.title': 'القوائم المالية والمقارنة والتحليلات والمؤشرات',
  'help.screen.statements.summary': 'اعرض قوائم الدخل والمركز المالي والتدفقات النقدية وتحليلات الانحراف والمؤشرات.',
  'help.screen.statements.whatToCheck': 'تحقق من نجاح فحوصات الربط A1-A5 وفصل الحسابات الفعلية غير المخططة.',
  'help.screen.statements.nextStep': 'افتح حزمة مجلس الإدارة لمعاينة وتصدير ملفات XLSX و PDF و PPTX.',
  'help.screen.board_pack.title': 'معاينة وتصدير حزمة مجلس الإدارة',
  'help.screen.board_pack.summary': 'صدّر حزم مجلس الإدارة بصيغ XLSX و PDF و PPTX من مصدر خادمي موحد.',
  'help.screen.board_pack.whatToCheck': 'تأكد من اجتياز فحوصات الربط وتوثيق بصمات دفعات المصدر قبل التحميل.',
  'help.screen.board_pack.nextStep': 'احفظ التقارير المصدرة واعتمد قائمة التحقق للإعداد من هذا الدليل.',
  'checklist.step.company_setup.title': 'الشركة والتقويم المالي',
  'checklist.step.company_setup.description': 'إنشاء سجل الشركة وتوليد الفترات المالية في قاعدة البيانات.',
  'checklist.step.chart_of_accounts.title': 'دليل الحسابات النشط',
  'checklist.step.chart_of_accounts.description': 'اعتماد حساب واحد على الأقل قابل للترحيل عبر ملف CSV أو حزمة قطاعية.',
  'checklist.step.actuals_import.title': 'خط الأساس للقيود الفعلية المتوازنة',
  'checklist.step.actuals_import.description': 'ترحيل دفعة قيود فعلية متوازنة وفعالة للشركة.',
  'checklist.step.plan_baseline.title': 'إصدار الخطة أو الميزانية المعتمد',
  'checklist.step.plan_baseline.description': 'اعتماد إصدار خطة ميزانية أو محركات أو قوى عاملة.',
  'checklist.step.owner_signoff.title': 'اعتماد جاهزية المالك',
  'checklist.step.owner_signoff.description': 'توثيق توقيع مالك أو محرر مساحة العمل في سجل التدقيق المتسلسل.',
};

export const I18N_MESSAGES = {
  'en-US': EN_US_MESSAGES,
  'ar-SA': AR_SA_MESSAGES,
} as const;

const PSEUDO_MAP: Readonly<Record<string, string>> = {
  a: 'á',
  e: 'é',
  i: 'í',
  o: 'ó',
  u: 'ú',
  A: 'Á',
  E: 'É',
  I: 'Í',
  O: 'Ó',
  U: 'Ú',
};

/** Deterministic pseudolocale expansion verifying zero hardcoded untranslated chrome (LOC1). */
export function toPseudoLocale(input: string): string {
  let out = '';
  for (const ch of input) {
    out += PSEUDO_MAP[ch] ?? ch;
  }
  return `[~${out}~]`;
}

export function getMissingTranslationKeys(locale: SupportedLocale): readonly I18nMessageKey[] {
  if (locale === 'en-US') return [];
  if (locale === 'pseudo') {
    return I18N_MESSAGE_KEYS.filter((k) => EN_US_MESSAGES[k].trim().length === 0);
  }
  const catalog = I18N_MESSAGES[locale];
  return I18N_MESSAGE_KEYS.filter((k) => {
    const val = catalog[k];
    return typeof val !== 'string' || val.trim().length === 0;
  });
}

export function getTranslationCoverage(locale: SupportedLocale): {
  readonly locale: SupportedLocale;
  readonly totalKeys: number;
  readonly translatedKeys: number;
  readonly missingKeys: readonly I18nMessageKey[];
} {
  const missingKeys = getMissingTranslationKeys(locale);
  const totalKeys = I18N_MESSAGE_KEYS.length;
  return {
    locale,
    totalKeys,
    translatedKeys: totalKeys - missingKeys.length,
    missingKeys,
  };
}

export function translateMessage(locale: SupportedLocale, key: I18nMessageKey): string {
  if (locale === 'pseudo') {
    return toPseudoLocale(EN_US_MESSAGES[key]);
  }
  return I18N_MESSAGES[locale][key];
}

export interface LocalizedScreenHelp {
  readonly routeId: SpineRouteId;
  readonly helpKey: `help.screen.${SpineRouteId}`;
  readonly title: string;
  readonly summary: string;
  readonly whatToCheck: string;
  readonly nextStep: string;
}

export function getScreenHelp(routeId: SpineRouteId, locale: SupportedLocale): LocalizedScreenHelp {
  return {
    routeId,
    helpKey: SPINE_HELP_KEYS[routeId],
    title: translateMessage(locale, `help.screen.${routeId}.title`),
    summary: translateMessage(locale, `help.screen.${routeId}.summary`),
    whatToCheck: translateMessage(locale, `help.screen.${routeId}.whatToCheck`),
    nextStep: translateMessage(locale, `help.screen.${routeId}.nextStep`),
  };
}

/**
 * Display-only UTC instant formatting into the user's chosen IANA timezone (TMP3).
 * Never feeds calculation engines or mutates ledger dates.
 */
export function formatUtcInstantForDisplay(
  utcInstant: string,
  locale: SupportedLocale,
  timeZone: string,
): string {
  const parsedInstant = UtcInstantSchema.parse(utcInstant);
  const validZone = DisplayTimeZoneSchema.parse(timeZone);
  const effectiveLocale = locale === 'pseudo' ? 'en-US' : locale;
  const formatted = new Intl.DateTimeFormat(effectiveLocale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: validZone,
    timeZoneName: 'short',
  }).format(new Date(Date.parse(parsedInstant)));
  return locale === 'pseudo' ? `[~${formatted}~]` : formatted;
}

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND']);

export function getCurrencyDecimalPlaces(currencyCode: string): 0 | 2 | 3 {
  const upper = currencyCode.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
  return 2;
}

/**
 * Presentation-only localized currency string formatter from a canonical server decimal string (LOC2).
 * Uses exact string splitting + BigInt grouping so arbitrary precision survives without JS floats.
 */
export function formatLocalizedCurrencyDisplay(
  canonicalDecimal: string,
  currencyCode: string,
  locale: SupportedLocale,
): string {
  const trimmed = canonicalDecimal.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`INVALID_CANONICAL_DECIMAL: "${canonicalDecimal}"`);
  }
  const signPrefix = match[1] === '-' ? '-' : '';
  const wholeDigits = match[2]!;
  const fracRaw = match[3] ?? '';
  const targetPlaces = getCurrencyDecimalPlaces(currencyCode);
  const effectiveLocale = locale === 'pseudo' ? 'en-US' : locale;

  const groupedWhole = new Intl.NumberFormat(effectiveLocale, {
    useGrouping: true,
    numberingSystem: 'latn',
  }).format(BigInt(wholeDigits));

  let renderedNumber = groupedWhole;
  if (targetPlaces > 0) {
    const paddedFrac = fracRaw.padEnd(targetPlaces, '0').slice(0, targetPlaces);
    const decimalPart = new Intl.NumberFormat(effectiveLocale, {
      numberingSystem: 'latn',
    })
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.';
    renderedNumber = `${groupedWhole}${decimalPart}${paddedFrac}`;
  }

  const upperCurrency = currencyCode.trim().toUpperCase();
  const body = `${signPrefix}${upperCurrency} ${renderedNumber}`;
  return locale === 'pseudo' ? `[~${body}~]` : body;
}
