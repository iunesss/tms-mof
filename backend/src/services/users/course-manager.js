const { bcrypt, pool, ALLOWED_ROLE_CODES, sendError, parseRoles, toPositiveInteger, getRoleId, fetchAllowedUserById, writeAuditLog, applyAssignment } = require('./course-manager-setup');

/** عمليات المستخدمين لمدير الدورة ضمن نطاق الأدوار المسموح له بإدارتها. */
async function getUsers(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 10, 1),
      100
    );

    const offset = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();

    if (role && !ALLOWED_ROLE_CODES.includes(role)) {
      return sendError(res, 400, 'الدور المحدد غير مسموح.');
    }

    const conditions = [
      'u.deleted_at IS NULL',
      `
        EXISTS (
          SELECT 1
          FROM user_roles visible_ur
          INNER JOIN roles visible_r
            ON visible_r.id = visible_ur.role_id
          WHERE visible_ur.user_id = u.id
            AND visible_r.code IN (
              'AGENT',
              'DEPARTMENT_MANAGER',
              'EMPLOYEE'
            )
        )
      `,
      `
        NOT EXISTS (
          SELECT 1
          FROM user_roles hidden_ur
          INNER JOIN roles hidden_r
            ON hidden_r.id = hidden_ur.role_id
          WHERE hidden_ur.user_id = u.id
            AND hidden_r.code IN (
              'SUPER_ADMIN',
              'COURSE_MANAGER'
            )
        )
      `,
    ];

    const params = [];

    if (search) {
      conditions.push(`
        (
          u.username LIKE ?
          OR up.full_name LIKE ?
          OR up.employee_number LIKE ?
        )
      `);

      const value = `%${search}%`;
      params.push(value, value, value);
    }

    if (role) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM user_roles filter_ur
          INNER JOIN roles filter_r
            ON filter_r.id = filter_ur.role_id
          WHERE filter_ur.user_id = u.id
            AND filter_r.code = ?
        )
      `);

      params.push(role);
    }

    if (status === 'active') {
      conditions.push('u.is_active = TRUE');
    }

    if (status === 'inactive') {
      conditions.push('u.is_active = FALSE');
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM users u
        LEFT JOIN user_profiles up
          ON up.user_id = u.id
        WHERE ${whereClause}
      `,
      params
    );

    const [users] = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.is_active,
          up.full_name,
          up.employee_number,

          GROUP_CONCAT(DISTINCT r.code ORDER BY r.code) AS roles_text,

          MAX(agent_sector.name) AS sector_name,
          MAX(manager_department.name) AS department_name,
          MAX(employee_manager_profile.full_name) AS department_manager_name

        FROM users u

        LEFT JOIN user_profiles up
          ON up.user_id = u.id

        LEFT JOIN user_roles ur
          ON ur.user_id = u.id

        LEFT JOIN roles r
          ON r.id = ur.role_id

        LEFT JOIN sector_agent_assignments own_agent_assignment
          ON own_agent_assignment.agent_user_id = u.id
          AND own_agent_assignment.end_date IS NULL

        LEFT JOIN sectors agent_sector
          ON agent_sector.id = own_agent_assignment.sector_id

        LEFT JOIN department_manager_assignments own_manager_assignment
          ON own_manager_assignment.manager_user_id = u.id
          AND own_manager_assignment.end_date IS NULL

        LEFT JOIN departments manager_department
          ON manager_department.id = own_manager_assignment.department_id

        LEFT JOIN employee_department_assignments employee_assignment
          ON employee_assignment.employee_user_id = u.id
          AND employee_assignment.end_date IS NULL

        LEFT JOIN department_manager_assignments employee_manager
          ON employee_manager.id = employee_assignment.manager_assignment_id

        LEFT JOIN user_profiles employee_manager_profile
          ON employee_manager_profile.user_id = employee_manager.manager_user_id

        WHERE ${whereClause}

        GROUP BY
          u.id,
          u.username,
          u.is_active,
          up.full_name,
          up.employee_number

        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      users: users.map((user) => ({
        ...user,
        roles: parseRoles(user.roles_text),
      })),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Course manager list users error:', error);
    return sendError(res, 500, 'تعذر تحميل المستخدمين.');
  }
}

async function getUserById(req, res) {
  try {
    const userId = toPositiveInteger(req.params.userId);

    if (!userId) {
      return sendError(res, 400, 'معرّف المستخدم غير صالح.');
    }

    const user = await fetchAllowedUserById(pool, userId);

    if (!user) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    return res.json({ user });
  } catch (error) {
    console.error('Course manager get user error:', error);
    return sendError(res, 500, 'تعذر تحميل بيانات المستخدم.');
  }
}

async function getOrganizationOptions(req, res) {
  try {
    const [agents] = await pool.query(`
      SELECT DISTINCT
        u.id,
        u.username,
        up.full_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'AGENT'
      LEFT JOIN sector_agent_assignments saa
        ON saa.agent_user_id = u.id
        AND saa.end_date IS NULL
      LEFT JOIN sectors s
        ON s.id = saa.sector_id
      WHERE u.is_active = TRUE
        AND u.deleted_at IS NULL
      ORDER BY up.full_name ASC
    `);

    const [managers] = await pool.query(`
      SELECT DISTINCT
        u.id,
        u.username,
        up.full_name,
        d.id AS department_id,
        d.name AS department_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'DEPARTMENT_MANAGER'
      LEFT JOIN department_manager_assignments dma
        ON dma.manager_user_id = u.id
        AND dma.end_date IS NULL
      LEFT JOIN departments d
        ON d.id = dma.department_id
      LEFT JOIN sectors s
        ON s.id = d.sector_id
      WHERE u.is_active = TRUE
        AND u.deleted_at IS NULL
      ORDER BY s.name ASC, d.name ASC, up.full_name ASC
    `);

    return res.json({
      agents,
      managers,
    });
  } catch (error) {
    console.error('Course manager organization options error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل خيارات التعيين الإداري.'
    );
  }
}

async function createUser(req, res) {
  const connection = await pool.getConnection();

  try {
    const {
      username,
      password,
      roleCode,
      fullName,
      employeeNumber,
      assignment,
    } = req.body;

    if (
      !username?.trim() ||
      !password ||
      password.length < 8 ||
      !fullName?.trim() ||
      !ALLOWED_ROLE_CODES.includes(roleCode)
    ) {
      return sendError(res, 400, 'بيانات المستخدم غير مكتملة أو غير صالحة.');
    }

    await connection.beginTransaction();

    const roleId = await getRoleId(connection, roleCode);

    if (!roleId) {
      throw new Error('الدور المحدد غير موجود.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [userResult] = await connection.execute(
      `
        INSERT INTO users (
          username,
          password_hash,
          is_active,
          created_by_user_id
        )
        VALUES (?, ?, TRUE, ?)
      `,
      [
        username.trim(),
        passwordHash,
        req.user.id,
      ]
    );

    const userId = userResult.insertId;

    await connection.execute(
      `
        INSERT INTO user_profiles (
          user_id,
          full_name,
          employee_number
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        fullName.trim(),
        employeeNumber?.trim() || null,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_roles (
          user_id,
          role_id,
          assigned_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        roleId,
        req.user.id,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_creation_history (
          created_user_id,
          creator_user_id,
          role_at_creation
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        req.user.id,
        roleCode,
      ]
    );

    await applyAssignment(
      connection,
      userId,
      roleCode,
      assignment,
      req.user.id
    );

    await writeAuditLog(
      connection,
      req.user.id,
      'COURSE_MANAGER_USER_CREATED',
      userId,
      {
        username: username.trim(),
        roleCode,
      }
    );

    await connection.commit();

    return res.status(201).json({
      message: 'تم إنشاء المستخدم بنجاح.',
      userId,
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        409,
        'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.'
      );
    }

    console.error('Course manager create user error:', error);
    return sendError(
      res,
      400,
      error.message || 'تعذر إنشاء المستخدم.'
    );
  } finally {
    connection.release();
  }
}

async function updateUser(req, res) {
  const connection = await pool.getConnection();

  try {
    const userId = toPositiveInteger(req.params.userId);

    const {
      username,
      roleCode,
      fullName,
      employeeNumber,
      newPassword,
      assignment,
    } = req.body;

    if (
      !userId ||
      !username?.trim() ||
      !fullName?.trim() ||
      !ALLOWED_ROLE_CODES.includes(roleCode)
    ) {
      return sendError(res, 400, 'بيانات المستخدم غير مكتملة أو غير صالحة.');
    }

    if (newPassword && newPassword.length < 8) {
      return sendError(
        res,
        400,
        'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'
      );
    }

    const currentUser = await fetchAllowedUserById(connection, userId);

    if (!currentUser) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE users
        SET username = ?
        WHERE id = ?
      `,
      [
        username.trim(),
        userId,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_profiles (
          user_id,
          full_name,
          employee_number
        )
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          employee_number = VALUES(employee_number)
      `,
      [
        userId,
        fullName.trim(),
        employeeNumber?.trim() || null,
      ]
    );

    if (newPassword) {
      const passwordHash = await bcrypt.hash(newPassword, 12);

      await connection.execute(
        `
          UPDATE users
          SET password_hash = ?
          WHERE id = ?
        `,
        [
          passwordHash,
          userId,
        ]
      );
    }

    const roleId = await getRoleId(connection, roleCode);

    if (!roleId) {
      throw new Error('الدور المحدد غير موجود.');
    }

    await connection.execute(
      'DELETE FROM user_roles WHERE user_id = ?',
      [userId]
    );

    await connection.execute(
      `
        INSERT INTO user_roles (
          user_id,
          role_id,
          assigned_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        roleId,
        req.user.id,
      ]
    );

    await applyAssignment(
      connection,
      userId,
      roleCode,
      assignment,
      req.user.id
    );

    await writeAuditLog(
      connection,
      req.user.id,
      'COURSE_MANAGER_USER_UPDATED',
      userId,
      {
        username: username.trim(),
        roleCode,
      }
    );

    await connection.commit();

    return res.json({
      message: 'تم حفظ تعديلات المستخدم بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        409,
        'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.'
      );
    }

    console.error('Course manager update user error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر حفظ تعديلات المستخدم.'
    );
  } finally {
    connection.release();
  }
}

async function updateUserStatus(req, res) {
  try {
    const userId = toPositiveInteger(req.params.userId);
    const { isActive, reason } = req.body;

    if (!userId || typeof isActive !== 'boolean') {
      return sendError(res, 400, 'بيانات تغيير الحالة غير صالحة.');
    }

    if (!isActive && !reason?.trim()) {
      return sendError(res, 400, 'سبب إيقاف الحساب مطلوب.');
    }

    const user = await fetchAllowedUserById(pool, userId);

    if (!user) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    await pool.execute(
      `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
      `,
      [
        isActive,
        userId,
      ]
    );

    await writeAuditLog(
      pool,
      req.user.id,
      'COURSE_MANAGER_USER_STATUS_CHANGED',
      userId,
      {
        isActive,
        reason: reason?.trim() || null,
      }
    );

    return res.json({
      message: isActive
        ? 'تم تنشيط الحساب بنجاح.'
        : 'تم إيقاف الحساب بنجاح.',
    });
  } catch (error) {
    console.error('Course manager update user status error:', error);

    return sendError(
      res,
      500,
      'تعذر تحديث حالة المستخدم.'
    );
  }
}

module.exports = {
  getUsers,
  getUserById,
  getOrganizationOptions,
  createUser,
  updateUser,
  updateUserStatus,
};

