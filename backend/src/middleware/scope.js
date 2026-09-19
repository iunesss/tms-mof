const pool = require('../config/database');

function isSuperAdmin(user) {
  return user?.roles?.includes('SUPER_ADMIN') === true;
}

function isCourseManager(user) {
  return user?.roles?.includes('COURSE_MANAGER') === true;
}

function deny(res) {
  return res.status(403).json({
    code: 'SCOPE_FORBIDDEN',
    message: 'هذا السجل خارج نطاق صلاحياتك.',
  });
}

// يستخدم عند فتح ملف مستخدم أو Profile.
// المستخدم يرى نفسه فقط، وSuper Admin فقط يستطيع رؤية أي ملف.
function requireOwnProfile(req, res, next) {
  const targetUserId = Number(req.params.userId);

  if (isSuperAdmin(req.user) || (req.user && Number(req.user.id) === targetUserId)) {
    return next();
  }

  return deny(res);
}

// Agent لا يستطيع الوصول إلا إلى قطاعه الحالي.
async function requireAgentSector(req, res, next) {
  try {
    const sectorId = Number(req.params.sectorId);

    if (isSuperAdmin(req.user) || isCourseManager(req.user)) {
      return next();
    }

    if (!req.user.roles.includes('AGENT')) {
      return deny(res);
    }

    const [rows] = await pool.execute(
      `
        SELECT id
        FROM sector_agent_assignments
        WHERE sector_id = ?
          AND agent_user_id = ?
          AND end_date IS NULL
      `,
      [sectorId, req.user.id]
    );

    if (!rows.length) {
      return deny(res);
    }

    next();
  } catch (error) {
    next(error);
  }
}

// Department Manager لا يستطيع الوصول إلا إلى قسمه الحالي.
async function requireManagerDepartment(req, res, next) {
  try {
    const departmentId = Number(req.params.departmentId);

    if (isSuperAdmin(req.user) || isCourseManager(req.user)) {
      return next();
    }

    if (!req.user.roles.includes('DEPARTMENT_MANAGER')) {
      return deny(res);
    }

    const [rows] = await pool.execute(
      `
        SELECT id
        FROM department_manager_assignments
        WHERE department_id = ?
          AND manager_user_id = ?
          AND end_date IS NULL
      `,
      [departmentId, req.user.id]
    );

    if (!rows.length) {
      return deny(res);
    }

    next();
  } catch (error) {
    next(error);
  }
}

// التحقق من حق الوصول إلى Candidate.
// لا تستخدم هذا للوصول إلى الملفات؛ الملفات لها Middleware خاص أدناه.
async function requireCandidateAccess(req, res, next) {
  try {
    const candidateId = Number(req.params.candidateId);

    if (isSuperAdmin(req.user) || isCourseManager(req.user)) {
      return next();
    }

    const [rows] = await pool.execute(
      `
        SELECT
          c.id,
          c.employee_user_id,
          n.department_id,
          n.agent_user_id
        FROM candidates c
        LEFT JOIN nominations n
          ON n.id = c.source_nomination_id
        WHERE c.id = ?
      `,
      [candidateId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: 'المرشح غير موجود.',
      });
    }

    const candidate = rows[0];

    // صاحب الترشيح يرى ملفه، بما فيه مدير القسم عند اختيار نفسه.
    if (
      String(candidate.employee_user_id) === String(req.user.id)
    ) {
      return next();
    }

    // الوكيل يرى المرشحين المرتبطين بترشيحات قطاعه.
    if (
      req.user.roles.includes('AGENT') &&
      candidate.agent_user_id === req.user.id
    ) {
      return next();
    }

    // مدير القسم يرى معلومات مرشحي قسمه،
    // لكنه لا يحصل على صلاحية المستندات.
    if (req.user.roles.includes('DEPARTMENT_MANAGER')) {
      const [managerRows] = await pool.execute(
        `
          SELECT id
          FROM department_manager_assignments
          WHERE department_id = ?
            AND manager_user_id = ?
            AND end_date IS NULL
        `,
        [candidate.department_id, req.user.id]
      );

      if (managerRows.length) {
        return next();
      }
    }

    return deny(res);
  } catch (error) {
    next(error);
  }
}

// المستندات الحساسة:
// Course Manager وSuper Admin فقط.
function requireDocumentReviewer(req, res, next) {
  const allowed =
    req.user.roles.includes('SUPER_ADMIN') ||
    req.user.roles.includes('COURSE_MANAGER');

  if (!allowed) {
    return res.status(403).json({
      code: 'DOCUMENT_ACCESS_DENIED',
      message: 'لا تملك صلاحية الوصول إلى مستندات المرشحين.',
    });
  }

  next();
}

module.exports = {
  requireOwnProfile,
  requireAgentSector,
  requireManagerDepartment,
  requireCandidateAccess,
  requireDocumentReviewer,
};
