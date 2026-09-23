/** قيم قاعدة البيانات والـAPI تبقى إنجليزية؛ هذه التسميات للعرض فقط. */
const courseStatuses = {
  DRAFT: 'مسودة',
  OPEN_FOR_NOMINATION: 'مفتوحة للترشيح',
  NOMINATION_CLOSED: 'أُغلق الترشيح',
  CANDIDATE_PROCESSING: 'قيد معالجة المرشحين',
  ACTIVE: 'نشطة',
  COMPLETED: 'مكتملة',
  ARCHIVED: 'مؤرشفة',
  CANCELLED: 'ملغاة',
};

const candidateStatuses = {
  SELECTED: 'تم الاختيار',
  DOCUMENTS_PENDING: 'بانتظار المستندات',
  DOCUMENTS_UNDER_REVIEW: 'قيد مراجعة المستندات',
  PRELIMINARILY_ACCEPTED: 'مقبول مبدئيًا',
  CONFIRMED: 'مؤكد',
  PARTICIPATING: 'مشارك',
  COMPLETED: 'أكمل الدورة',
  REJECTED: 'مرفوض',
  WITHDRAWN: 'منسحب',
  REMOVED: 'مستبعد',
  CANCELLED: 'ملغى',
};

const nominationStatuses = {
  DRAFT: 'مسودة',
  PENDING: 'بانتظار مراجعة الوكيل',
  PENDING_AGENT: 'بانتظار مراجعة الوكيل',
  SUBMITTED: 'بانتظار مراجعة الوكيل',
  AGENT_APPROVED: 'اعتمده الوكيل',
  AGENT_CONFIRMED: 'اعتمده الوكيل',
  AGENT_REJECTED: 'رفضه الوكيل',
  SELECTED: 'تم الاختيار',
  WITHDRAWN: 'تم السحب',
  CONVERTED_TO_CANDIDATE: 'تحوّل إلى مرشح',
  DOCUMENTS_PENDING: 'بانتظار المستندات',
  PRELIMINARILY_ACCEPTED: 'مقبول مبدئيًا',
  CONFIRMED: 'مؤكد',
  REJECTED: 'مرفوض',
};

const formStatuses = {
  PENDING: 'بانتظار الرفع',
  SUBMITTED: 'مرفوعة وتنتظر المراجعة',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمدة',
  REJECTED: 'مرفوضة وتحتاج إعادة رفع',
  RESUBMITTED: 'أُعيد رفعها وتنتظر المراجعة',
};

const documentStatuses = {
  PENDING: 'بانتظار المراجعة',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض ويحتاج إعادة رفع',
};

const attachmentTypes = {
  AGENDA: 'الأجندة',
  PROGRAM: 'برنامج الدورة',
  GENERAL_INVITATION: 'نموذج دعوة',
  COURSE_GUIDE: 'دليل الدورة',
  OFFICIAL_DOCUMENT: 'وثيقة رسمية',
  VISA: 'تأشيرة',
  TRAVEL_TICKET: 'تذكرة سفر',
  OFFICIAL_LETTER: 'خطاب رسمي',
  TRAVEL_DOCUMENT: 'مستند سفر',
  OTHER: 'مرفق آخر',
};

const profileDocumentTypes = {
  PASSPORT: 'جواز السفر',
  PERSONAL_PHOTO: 'الصورة الشخصية',
  IDENTITY_DOCUMENT: 'وثيقة الهوية',
  OTHER: 'مستند آخر',
};

const label = (labels, value) => labels[value] || (value ? 'غير معروف' : '—');

export const courseStatusText = (status) => label(courseStatuses, status);
export const candidateStatusText = (status) => label(candidateStatuses, status);
export const nominationStatusText = (status) => label(nominationStatuses, status);
export const formStatusText = (status) => label(formStatuses, status);
export const documentStatusText = (status) => label(documentStatuses, status);
export const attachmentTypeText = (type) => label(attachmentTypes, type);
export const profileDocumentTypeText = (type) => label(profileDocumentTypes, type);
