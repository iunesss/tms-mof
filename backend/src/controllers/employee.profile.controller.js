const fs = require('fs');
const crypto = require('crypto');

const pool = require('../config/database');
const { writeAuditLog } = require('../utils/audit');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toFileUrl(storageKey) {
  const baseUrl =
    process.env.API_PUBLIC_URL || 'http://localhost:3000';

  return `${baseUrl}/uploads/${storageKey}`;
}

function normalizeOriginalName(fileName = '') {
  if (/[\u00C0-\u00FF]/.test(fileName)) {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');

    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  }

  return fileName;
}

async function getProfileDocuments(connection, userProfileId) {
  const [documents] = await connection.query(
    `
      SELECT
        pd.id,
        pd.document_type,
        pd.label,
        pd.status,
        pd.created_at,

        pdv.id AS version_id,
        pdv.version_no,
        pdv.uploaded_at,

        f.id AS file_id,
        f.storage_key,
        f.original_name,
        f.mime_type,
        f.size_bytes

      FROM profile_documents pd

      INNER JOIN profile_document_versions pdv
        ON pdv.id = (
          SELECT latest_version.id
          FROM profile_document_versions latest_version
          WHERE latest_version.profile_document_id = pd.id
          ORDER BY latest_version.version_no DESC
          LIMIT 1
        )

      INNER JOIN files f
        ON f.id = pdv.file_id

      WHERE pd.user_profile_id = ?
        AND pd.deleted_at IS NULL

      ORDER BY
        pd.created_at DESC,
        pdv.version_no DESC
    `,
    [userProfileId]
  );

  return documents.map((document) => ({
    ...document,
    title:
      document.document_type === 'PASSPORT'
        ? 'جواز السفر'
        : document.label,

    file_url: toFileUrl(document.storage_key),
  }));
}

async function getCompleteProfile(connection, employeeUserId) {
  const [[profile]] = await connection.query(
    `
      SELECT
        u.id,
        u.username,
        u.is_active,

        up.user_id AS user_profile_id,
        up.full_name,
        up.employee_number,
        up.email,
        up.phone,
        up.job_title,

        d.id AS department_id,
        d.name AS department_name,

        s.id AS sector_id,
        s.name AS sector_name

      FROM users u

      INNER JOIN user_profiles up
        ON up.user_id = u.id

      LEFT JOIN employee_department_assignments eda
        ON eda.employee_user_id = u.id
        AND eda.end_date IS NULL

      LEFT JOIN departments d
        ON d.id = eda.department_id
        AND d.deleted_at IS NULL

      LEFT JOIN sectors s
        ON s.id = d.sector_id
        AND s.deleted_at IS NULL

      WHERE u.id = ?
        AND u.deleted_at IS NULL
    `,
    [employeeUserId]
  );

  if (!profile) {
    return null;
  }

  const documents = await getProfileDocuments(
    connection,
    profile.user_profile_id
  );

  return {
    ...profile,
    documents,
  };
}

async function getProfile(req, res, next) {
  try {
    const profile = await getCompleteProfile(
      pool,
      req.user.id
    );

    if (!profile) {
      return sendError(
        res,
        404,
        'تعذر العثور على بيانات الملف الشخصي.'
      );
    }

    return res.status(200).json({
      profile,
    });
  } catch (error) {
    next(error);
  }
}

async function savePassportVersion(
  connection,
  userProfileId,
  employeeUserId,
  file
) {
  const checksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file.path))
    .digest('hex');

  const storageKey = `profiles/${file.filename}`;

  const [fileResult] = await connection.query(
    `
      INSERT INTO files (
        storage_key,
        original_name,
        mime_type,
        size_bytes,
        checksum,
        uploaded_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      storageKey,
      normalizeOriginalName(file.originalname),
      file.mimetype,
      file.size,
      checksum,
      employeeUserId,
    ]
  );

  const [[passportDocument]] = await connection.query(
    `
      SELECT id
      FROM profile_documents
      WHERE user_profile_id = ?
        AND document_type = 'PASSPORT'
        AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [userProfileId]
  );

  let profileDocumentId;

  if (passportDocument) {
    profileDocumentId = passportDocument.id;

    await connection.query(
      `
        UPDATE profile_documents
        SET
          label = 'جواز السفر',
          status = 'PENDING'
        WHERE id = ?
      `,
      [profileDocumentId]
    );
  } else {
    const [documentResult] = await connection.query(
      `
        INSERT INTO profile_documents (
          user_profile_id,
          document_type,
          label,
          status
        )
        VALUES (?, 'PASSPORT', 'جواز السفر', 'PENDING')
      `,
      [userProfileId]
    );

    profileDocumentId = documentResult.insertId;
  }

  const [[latestVersion]] = await connection.query(
    `
      SELECT MAX(version_no) AS latest_version
      FROM profile_document_versions
      WHERE profile_document_id = ?
    `,
    [profileDocumentId]
  );

  const nextVersionNo =
    Number(latestVersion.latest_version || 0) + 1;

  await connection.query(
    `
      INSERT INTO profile_document_versions (
        profile_document_id,
        version_no,
        file_id,
        uploaded_by_user_id
      )
      VALUES (?, ?, ?, ?)
    `,
    [
      profileDocumentId,
      nextVersionNo,
      fileResult.insertId,
      employeeUserId,
    ]
  );
}

async function updateProfile(req, res, next) {
  const connection = await pool.getConnection();

  try {
    const employeeUserId = req.user.id;

    const email = String(req.body.email || '').trim() || null;
    const phone = String(req.body.phone || '').trim() || null;
    const jobTitle =
      String(req.body.jobTitle || '').trim() || null;

    await connection.beginTransaction();

    const [[currentProfile]] = await connection.query(
      `
        SELECT
          user_id AS user_profile_id,
          full_name,
          employee_number,
          email,
          phone,
          job_title
        FROM user_profiles
        WHERE user_id = ?
        FOR UPDATE
      `,
      [employeeUserId]
    );

    if (!currentProfile) {
      throw new Error('الملف الشخصي غير موجود.');
    }

    /*
      لا نحدّث الاسم أو الرقم الوظيفي هنا.
      تعديلهُما من صلاحيات مدير الدورة أو مدير النظام.
    */
    await connection.query(
      `
        UPDATE user_profiles
        SET
          email = ?,
          phone = ?,
          job_title = ?
        WHERE user_id = ?
      `,
      [
        email,
        phone,
        jobTitle,
        employeeUserId,
      ]
    );

    if (req.file) {
      await savePassportVersion(
        connection,
        currentProfile.user_profile_id,
        employeeUserId,
        req.file
      );
    }

    await writeAuditLog(connection, {
      actorUserId: employeeUserId,
      eventType: 'EMPLOYEE_PROFILE_UPDATED',
      entityType: 'USER_PROFILE',
      entityId: employeeUserId,

      beforeData: {
        email: currentProfile.email,
        phone: currentProfile.phone,
        jobTitle: currentProfile.job_title,
      },

      afterData: {
        email,
        phone,
        jobTitle,
        passportUpdated: Boolean(req.file),
      },
    });

    await connection.commit();

    const profile = await getCompleteProfile(
      connection,
      employeeUserId
    );

    return res.status(200).json({
      message: 'تم حفظ بيانات الملف الشخصي بنجاح.',
      profile,
    });
  } catch (error) {
    await connection.rollback();

    console.error('Employee profile update error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر حفظ الملف الشخصي.'
    );
  } finally {
    connection.release();
  }
}

module.exports = {
  getProfile,
  updateProfile,
};